const exposes = require('zigbee-herdsman-converters/lib/exposes');
const tuya = require('zigbee-herdsman-converters/lib/tuya');
const e = exposes.presets;
const ea = exposes.access;

// A schedule datapoint is 3 periods of 3 bytes each: hour, minute, temperature (whole °C).
const SCHEDULE_PERIODS = 3;
const SCHEDULE_TEMP_MIN = 5;
const SCHEDULE_TEMP_MAX = 35;

const parseScheduleData = (buffer) => {
    const periods = [];

    for (let i = 0; i + 2 < buffer.length; i += 3) {
        const hour = buffer.readUInt8(i).toString().padStart(2, '0');
        const minute = buffer.readUInt8(i + 1).toString().padStart(2, '0');
        const temperature = buffer.readUInt8(i + 2);
        periods.push(`${hour}:${minute}/${temperature.toFixed(1)}°C`);
    }
    return periods.length > 0 ? periods.join(' ') : null;
};

const serializeScheduleData = (scheduleStr) => {
    if (typeof scheduleStr !== 'string') {
        throw new Error('Schedule must be a string like "06:00/21.0°C 12:00/18.0°C 18:00/22.0°C"');
    }

    const periods = scheduleStr.trim().split(/\s+/);
    if (periods.length !== SCHEDULE_PERIODS) {
        throw new Error(`Schedule needs exactly ${SCHEDULE_PERIODS} periods, got ${periods.length}`);
    }

    const buffer = Buffer.alloc(SCHEDULE_PERIODS * 3);
    periods.forEach((period, index) => {
        const match = /^(\d{1,2}):(\d{2})\/(\d{1,2}(?:\.\d)?)(?:°C)?$/.exec(period);
        if (!match) {
            throw new Error(`Invalid period format: "${period}", expected hh:mm/cc.c°C`);
        }

        const hour = parseInt(match[1], 10);
        const minute = parseInt(match[2], 10);
        const temperature = parseFloat(match[3]);
        if (hour > 23 || minute > 59) {
            throw new Error(`Invalid time in period "${period}"`);
        }
        if (!Number.isInteger(temperature)) {
            throw new Error(`Invalid temperature in period "${period}", the schedule only supports whole degrees`);
        }
        if (temperature < SCHEDULE_TEMP_MIN || temperature > SCHEDULE_TEMP_MAX) {
            throw new Error(`Temperature in period "${period}" must be between ${SCHEDULE_TEMP_MIN} and ${SCHEDULE_TEMP_MAX}`);
        }

        buffer.writeUInt8(hour, index * 3);
        buffer.writeUInt8(minute, index * 3 + 1);
        buffer.writeUInt8(temperature, index * 3 + 2);
    });

    return buffer;
};

const scheduleConverter = {
    from: (value) => parseScheduleData(value),
    // The datapoints converter sends an array as a raw datapoint, which is what this device reports these as
    to: (value) => Array.from(serializeScheduleData(value)),
};

// Only bit 4 (16) has been observed so far: it is set while the high temperature protection is triggered.
const errorStatusConverter = {
    from: (value) => ({
        error_status: value,
        high_temperature_alarm: (value & 0x10) !== 0,
    }),
};

const scheduleExpose = (name, label) =>
    e.text(name, ea.STATE_SET)
        .withDescription(
            `Schedule for ${label} (Format: "hh:mm/cc.c°C hh:mm/cc.c°C hh:mm/cc.c°C", exactly ${SCHEDULE_PERIODS} periods, whole degrees). ` +
            'The thermostat only reports its schedules when they are edited on the device, so this can be stale until then.',
        )
        .withCategory('config');

const definition = {
    fingerprint: [
        { modelID: 'TS0601', manufacturerName: '_TZE200_znzs7yaw' },
    ],
    model: 'HY09',
    vendor: 'Tuya',
    description: 'Tuya HY09 boiler thermostat',
    extend: [tuya.modernExtend.tuyaBase({ dp: true, forceTimeUpdates: true, timeStart: '1970', queryOnConfigure: true })],
    exposes: [
        e
            .climate()
            .withSystemMode(['off', 'heat'], ea.STATE_SET)
            // The setpoint is limited by min_temperature / max_temperature on the device itself
            .withSetpoint('current_heating_setpoint', 5, 35, 0.5, ea.STATE_SET)
            .withRunningState(['idle', 'heat'], ea.STATE)
            // Presets are always settable through the climate helper, but the device ignores a remote switch back to "auto"
            .withPreset(
                ['auto', 'manual', 'mixed', 'holiday'],
                'Switching back to auto remotely is not supported by the device, use the buttons on the thermostat.',
            )
            .withLocalTemperatureCalibration(-9, 9, 1, ea.STATE_SET)
            .withLocalTemperature(ea.STATE),
        e.child_lock(),
        e.enum('power_on_behavior', ea.STATE_SET, ['previous', 'off', 'on'])
            .withDescription('State the thermostat goes to after a power loss. The manual only lists "with memory" (previous) and "without memory", so off and on may not be supported')
            .withCategory('config'),
        // Only reported when it changes on the device. It can be changed to IN remotely but not back, so it is read only.
        e
            .enum('sensor_mode', ea.STATE, ['IN', 'OU', 'AL'])
            .withDescription(
                'IN - internal sensor, no heat protection. OU - external sensor, no heat protection. ' +
                'AL - internal sensor for room temperature, external for heat protection',
            )
            .withCategory('diagnostic'),
        // Reads 0 when no external sensor is connected
        e.numeric('external_temperature', ea.STATE).withUnit('°C').withDescription('Temperature of the external sensor').withCategory('diagnostic'),
        e.numeric('holiday_days', ea.STATE_SET).withUnit('days').withValueMin(0).withValueMax(365).withCategory('config'),
        e.holiday_temperature().withValueMin(5).withValueMax(35).withCategory('config'),
        e.enum('schedule_type', ea.STATE_SET, ['5+2', '6+1', '7']).withDescription('Schedule type'),
        scheduleExpose('schedule_workdays_1', 'workdays AM'),
        scheduleExpose('schedule_workdays_2', 'workdays PM'),
        scheduleExpose('schedule_weekend_1', 'weekend AM'),
        scheduleExpose('schedule_weekend_2', 'weekend PM'),
        e
            .numeric('temperature_return_difference', ea.STATE_SET)
            .withUnit('°C')
            .withValueMin(0.5)
            .withValueMax(2.5)
            .withValueStep(0.5)
            .withDescription('Hysteresis: how far the room temperature may drift from the setpoint before heating switches')
            .withPreset('default', 0.5, 'Default value')
            .withCategory('config'),
        e
            .binary('high_temperature_protection_state', ea.STATE_SET, 'ON', 'OFF')
            .withDescription(
                'If temperature hit the HIGH temperature limit, it ' +
                'will turn off heating until it drops for amount of deadzone/hysteresis ' +
                'degrees',
            )
            .withCategory('config'),
        e
            .binary('low_temperature_protection_state', ea.STATE_SET, 'ON', 'OFF')
            .withDescription('If temperature hit the LOW temperature limit, it will turn heating on')
            .withCategory('config'),
        e
            .numeric('high_temperature_protection_setting', ea.STATE_SET)
            .withUnit('°C')
            .withValueMin(20)
            .withValueMax(70)
            .withDescription('Alarm temperature max. Setting it below 20 turns the high temperature protection off')
            .withPreset('default', 45, 'Default value')
            .withCategory('config'),
        e
            .numeric('low_temperature_protection_setting', ea.STATE_SET)
            .withUnit('°C')
            .withValueMin(1)
            .withValueMax(10)
            .withDescription('Alarm temperature min. Setting it above 10 turns the low temperature protection off')
            .withPreset('default', 5, 'Default value')
            .withCategory('config'),
        e
            .deadzone_temperature()
            .withValueMin(1)
            .withValueMax(9)
            .withValueStep(1)
            .withUnit('°C')
            .withDescription('Protection hysteresis: how far the temperature must drop below the high temperature limit before heating resumes')
            .withPreset('default', 1, 'Default value')
            .withCategory('config'),
        e.max_temperature().withValueMin(20).withValueMax(90).withPreset('default', 35, 'Default value').withCategory('config'),
        e.min_temperature().withValueMin(1).withValueMax(10).withPreset('default', 5, 'Default value').withCategory('config'),
        e.binary('high_temperature_alarm', ea.STATE, true, false).withDescription('The high temperature protection has been triggered'),
        tuya.exposes.errorStatus(),
    ],
    meta: {
        tuyaDatapoints: [
            [102, 'running_state', tuya.valueConverterBasic.lookup({ idle: false, heat: true })],
            // external sensor temperature, 0 when no sensor is connected
            [103, 'external_temperature', tuya.valueConverter.divideBy10],
            // holiday days
            [104, 'holiday_days', tuya.valueConverter.raw],
            // holiday temperature
            [105, 'holiday_temperature', tuya.valueConverter.raw],
            // can be changed by setting 112 below 20, data type 1
            [106, 'high_temperature_protection_state', tuya.valueConverter.onOff],
            // can be changed by setting 113 over 10, data type 1
            [107, 'low_temperature_protection_state', tuya.valueConverter.onOff],
            // range -9 to +9, sent in tenths of a degree (raw 10 = +1.0), affects shown room temperature
            // (even tho sensors detect its 19, you can make it show 21 by setting this to 2)
            [109, 'local_temperature_calibration', tuya.valueConverter.divideBy10],
            // according to manual settable between 0.5 and 2.5 degree.
            // starting with 5 as 0.5 degree, and 25 as 2.5 degree (data type 2)
            [110, 'temperature_return_difference', tuya.valueConverter.divideBy10],
            // range 1-9. How far should temperature drop to turn back heating, if high temp protection kicked in
            [111, 'deadzone_temperature', tuya.valueConverter.raw],
            // High temperature protection
            // range 20-70, trying to turn below 20 keeps this datapoint at 20 but turns 106 to 0
            [112, 'high_temperature_protection_setting', tuya.valueConverter.raw],
            // range 1-10, trying to turn over 10 keeps this datapoint at 10, but turns 107 to 0
            [113, 'low_temperature_protection_setting', tuya.valueConverter.raw],
            [114, 'max_temperature', tuya.valueConverter.raw],
            [115, 'min_temperature', tuya.valueConverter.raw],
            // choose_sensor
            // 0: device sensor. Switches "high_temperature_protection_state" off
            // 1: external sensor / high temperature protection off
            // 2: internal for room + external for high temperature protection. Switches "high_temperature_protection_state" on
            [116, 'sensor_mode', tuya.valueConverterBasic.lookup({ IN: tuya.enum(0), OU: tuya.enum(1), AL: tuya.enum(2) })],
            // 0 is what this device reports, the mapping of 1 and 2 is not verified
            [117, 'power_on_behavior', tuya.valueConverterBasic.lookup({ previous: tuya.enum(0), off: tuya.enum(1), on: tuya.enum(2) })],
            [118, 'schedule_type', tuya.valueConverterBasic.lookup({ '5+2': tuya.enum(0), '6+1': tuya.enum(1), '7': tuya.enum(2) })],
            [119, 'schedule_workdays_1', scheduleConverter],
            [120, 'schedule_workdays_2', scheduleConverter],
            [121, 'schedule_weekend_1', scheduleConverter],
            [122, 'schedule_weekend_2', scheduleConverter],
            // device state
            // 0: standby mode - displays temperature but will not turn heating. Manual configuration is accessible only in this state
            // 1: fully functional, can turn on heating
            [125, 'system_mode', tuya.valueConverterBasic.lookup({ off: false, heat: true })],
            [126, 'current_heating_setpoint', tuya.valueConverter.divideBy10],
            // internal sensor temperature
            [127, 'local_temperature', tuya.valueConverter.divideBy10],
            // manual_mode
            // 1: automatically turns heating when protection levels hit
            // 2: you can turn off heating if it heats. You can set up target temperature
            // 3: you can set up target temperature and it will automatically try to maintain it
            [128, 'preset', tuya.valueConverterBasic.lookup({ manual: tuya.enum(0), auto: tuya.enum(1), holiday: tuya.enum(2), mixed: tuya.enum(3) })],
            [129, 'child_lock', tuya.valueConverter.lockUnlock],
            // data type 5. Was 0 but went 16 when high temperature protection went into alert mode
            [130, null, errorStatusConverter],
        ],
    },
};

module.exports = definition;
