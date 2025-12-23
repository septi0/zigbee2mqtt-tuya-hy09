const fz = require('zigbee-herdsman-converters/converters/fromZigbee');
const tz = require('zigbee-herdsman-converters/converters/toZigbee');
const exposes = require('zigbee-herdsman-converters/lib/exposes');
const tuya = require('zigbee-herdsman-converters/lib/tuya');
const { precisionRound } = require('zigbee-herdsman-converters/lib/utils');
const e = exposes.presets;
const ea = exposes.access;

const fzScheduleConverter = {
    from: (value, meta) => {
        return parseScheduleData(value);
    },
    to: (value, meta) => {
        return serializeScheduleData(value).toString();
    }
};

const parseScheduleData = (buffer) => {
    const periods = [];

    for (let i = 0; i < buffer.length; i += 3) {
        const hour = buffer.readUInt8(i), minute = buffer.readUInt8(i + 1), tempRaw = buffer.readUInt8(i + 2);
        const tempCelsius = precisionRound(tempRaw / 1, 1);
        const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        periods.push(`${timeStr}/${tempCelsius.toFixed(1)}°C`);
    }
    return periods.length > 0 ? periods.join(' ') : null;
};

const serializeScheduleData = (scheduleStr) => {
    const buffer = Buffer.alloc(9);
    const periods = scheduleStr.replace(/\s+/g, ' ').trim().split(' ');

    if (periods.length != 3) {
        throw new Error('Schedule string has too many periods, maximum is 3');
    }

    periods.forEach((period, index) => {
        if ((period.match(/:/g) || []).length !== 1 || (period.match(/\//g) || []).length !== 1) {
            throw new Error(`Invalid period format: ${period}`);
        }

        const [timePart, tempPart] = period.split('/');
        const [hourStr, minuteStr] = timePart.split(':');
        const hour = parseInt(hourStr, 10);
        const minute = parseInt(minuteStr, 10);
        const tempCelsius = parseFloat(tempPart.replace('°C', ''));
        const tempRaw = Math.round(tempCelsius);

        buffer.writeUInt8(hour, index * 3);
        buffer.writeUInt8(minute, index * 3 + 1);
        buffer.writeUInt8(tempRaw, index * 3 + 2);
    });

    return buffer;
};

const definition = {
    zigbeeModel: ['TS0601'],
    model: 'HY09',
    vendor: 'Tuya',
    description: 'Tuya HY09 boiler thermostat',
    whiteLabel: [{ vendor: 'Tuya', model: 'HY09' }],
    fingerprint: [
        { modelID: 'TS0601', manufacturerName: '_TZE200_znzs7yaw' },
    ],
    extend: [tuya.modernExtend.tuyaBase({ dp: true, forceTimeUpdates: true, timeStart: "1970" })],
    exposes: [
        // e.binary('system_mode', ea.STATE_SET, 'ON', 'OFF')
        // .withDescription('Turn system on or standby mode'),
        // e
        //     .binary("state", ea.STATE_SET, "ON", "OFF")
        //     .withDescription("Turn system on or standby mode"),
        e
            .climate()
            .withSystemMode(["off", "heat"], ea.STATE_SET)
            .withSetpoint("current_heating_setpoint", 5, 35, 0.5, ea.STATE_SET)
            .withRunningState(["idle", "heat"], ea.STATE)

            // you can change preset, but can't make auto back remotely so I would set this readonly
            .withPreset(["auto", "manual", "mixed", "holiday"], ea.STATE_SET)
            .withLocalTemperatureCalibration(-9, 9, 1, ea.STATE_SET)
            .withLocalTemperature(ea.STATE),
        e.child_lock(),
        // you can change it to IN remotely but can not set it back, so I set it read only
        // e
        //     .enum("sensor_mode", ea.STATE, ["IN", "OU", "AL"])
        //     .withDescription(
        //         "IN - internal sensor, no heat protection. OU - external sensor, no heat protection. AL - internal sensor for room temperature, external for heat protection",
        //     ),
        e.numeric("holiday_days", ea.STATE_SET).withValueMin(0).withValueMax(365).withCategory("config"),
        e.holiday_temperature().withValueMin(5).withValueMax(35).withCategory("config"),
        e.enum('schedule_type', ea.STATE_SET, ['5+2', '6+1', '7']).withDescription('Schedule type'),
        e.text('schedule_workdays_1', ea.STATE_SET)
            .withDescription('Schedule for workdays AM (Format: "hh:mm/cc.c°C hh:mm/cc.c°C hh:mm/cc.c°C", exactly 3 periods)')
            .withCategory("config"),
        e.text('schedule_workdays_2', ea.STATE_SET)
            .withDescription('Schedule for workdays PM (Format: "hh:mm/cc.c°C hh:mm/cc.c°C hh:mm/cc.c°C", exactly 3 periods)')
            .withCategory("config"),
        e.text('schedule_weekend_1', ea.STATE_SET)
            .withDescription('Schedule for weekend AM (Format: "hh:mm/cc.c°C hh:mm/cc.c°C hh:mm/cc.c°C", exactly 3 periods)')
            .withCategory("config"),
        e.text('schedule_weekend_2', ea.STATE_SET)
            .withDescription('Schedule for weekend PM (Format: "hh:mm/cc.c°C hh:mm/cc.c°C hh:mm/cc.c°C", exactly 3 periods)')
            .withCategory("config"),
        e
            .binary("high_temperature_protection_state", ea.STATE_SET, "ON", "OFF")
            .withDescription(
                "If temperature hit the HIGH temperature limit, it " +
                "will turn off heating until it drops for amount of deadzone/hysteresis " +
                "degrees",
            )
            .withCategory("config"),
        e.binary("low_temperature_protection_state", ea.STATE_SET, "ON", "OFF").withCategory("config"),
        e
            .numeric("high_temperature_protection_setting", ea.STATE_SET)
            .withUnit("°C")
            .withValueMin(20)
            .withValueMax(70)
            .withDescription("Alarm temperature max")
            .withPreset("default", 45, "Default value")
            .withCategory("config"),
        e
            .numeric("low_temperature_protection_setting", ea.STATE_SET)
            .withUnit("°C")
            .withValueMin(1)
            .withValueMax(10)
            .withDescription("Alarm temperature min")
            .withPreset("default", 5, "Default value")
            .withCategory("config"),
        e
            .deadzone_temperature()
            .withValueMin(1)
            .withValueMax(9)
            .withValueStep(1)
            .withUnit("°C")
            .withDescription("Hysteresis")
            .withPreset("default", 1, "Default value")
            .withCategory("config"),
        e.max_temperature().withValueMin(20).withValueMax(70).withPreset("default", 35, "Default value").withCategory("config"),
        e.min_temperature().withValueMin(5).withValueMax(35).withPreset("default", 5, "Default value").withCategory("config"),
        tuya.exposes.errorStatus(),
    ],
    meta: {
        tuyaDatapoints: [
            [102, "running_state", tuya.valueConverterBasic.lookup({ idle: false, heat: true })],
            // [103, "temperature_sensor", tuya.valueConverter.divideBy10],
            // holiday days
            [104, "holiday_days", tuya.valueConverter.raw],
            // holiday temperature
            [105, "holiday_temperature", tuya.valueConverter.raw],
            // can be changed by setting 112 below 20, data type 1
            [106, "high_temperature_protection_state", tuya.valueConverter.onOff],
            // can be changed by setting 113 over 10, data type 1
            [107, "low_temperature_protection_state", tuya.valueConverter.onOff],
            // range -9 to +9, data type 2, affects shown room temperature (even tho sensors detect its 19, you can make it show 21 by setting this to 2)
            [109, "local_temperature_calibration", tuya.valueConverter.localTempCalibration3],
            // according to manual settable between 0.5 and 2.5 degree.
            // staring with 5 as 0.5 degree, and 25 as 2.5 degree (data type 2)
            [110, "temperature_return_difference", tuya.valueConverter.raw],
            // range 1-9. How far should temperature drop to turn back heating, if high temp protection kicked in
            [111, "deadzone_temperature", tuya.valueConverter.raw],
            // High temperature protection
            // range 20-70, trying to turn below 20 keeps this datapoint at 20 but turns 106 to 0
            [112, "high_temperature_protection_setting", tuya.valueConverter.raw],
            // range 1-10, trying to turn over 10 keeps this datapoint at 10, but turns 107 to 0
            [113, "low_temperature_protection_setting", tuya.valueConverter.raw],
            [114, "max_temperature", tuya.valueConverter.raw],
            [115, "min_temperature", tuya.valueConverter.raw],
            // choose_sensor
            // 0: device sensor. Switches "higsyht_temperature_protection_state" off
            // 1: external sensor / high temperature protection off
            // 2: internal for room + external for high temperature protection. Switches "hight_temperature_protection_state" on
            // [116, "sensor_mode", tuya.valueConverterBasic.lookup({ IN: 0, OU: 1, AL: 2 })],
            // [117, "power_on_behavior", tuya.valueConverterBasic.lookup({'previous': tuya.enum(0), 'off': tuya.enum(1), 'on': tuya.enum(2)})],
            [118, "schedule_type", tuya.valueConverterBasic.lookup({ '5+2': tuya.enum(0), '6+1': tuya.enum(1), '7': tuya.enum(2) })],
            [119, "schedule_workdays_1", fzScheduleConverter],
            [120, "schedule_workdays_2", fzScheduleConverter],
            [121, "schedule_weekend_1", fzScheduleConverter],
            [122, "schedule_weekend_2", fzScheduleConverter],
            // device state
            // 0: standby mode - displays temperature but will not turn heating. Manual configuration is accessible only in this state
            // 1: fully functional, can turn on heating
            [125, "system_mode", tuya.valueConverterBasic.lookup({ off: false, heat: true })],
            // [125, "state", tuya.valueConverter.onOff],
            [126, "current_heating_setpoint", tuya.valueConverter.divideBy10],
            // internal sensor temperature
            [127, "local_temperature", tuya.valueConverter.divideBy10],
            // manual_mode
            // 1: automatically turns heating when protection levels hit
            // 2: you can turn off heating if it heats. You can set up target temperature
            // 3: you can set up target temperature and it will automatically try to maintain it
            [128, "preset", tuya.valueConverterBasic.lookup({ manual: tuya.enum(0), auto: tuya.enum(1), holiday: tuya.enum(2), mixed: tuya.enum(3) })],
            [129, "child_lock", tuya.valueConverter.lockUnlock],
            // data type 5. Was [0] but went [16] when high temperature protection went into alert mode
            [130, "error_status", tuya.valueConverter.raw],
        ],
    },
};

module.exports = definition;