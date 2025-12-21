# Tuya HY09 Boiler Thermostat – Zigbee2MQTT External Converter

This repository provides an **external Zigbee2MQTT converter** for No-Brand **HY09 boiler thermostat**.

The device **reports itself as `TS0601` with manufacturer `_TZE200_znzs7yaw`**, but this Zigbee identification is **wrong** and does **not reflect the actual datapoint layout** of this device.
As a result, default Zigbee2MQTT converters expose incorrect or incomplete functionality.

This converter intentionally **overrides the reported Zigbee identity** and implements the **correct datapoint mapping for the HY09 thermostat**, based on real device behavior.

![Thermostat](img/thermostat.jpg)
![Circuitboard](img/circuitboard.png)

## Installation

Copy the converter file into your Zigbee2MQTT data directory, for example: `zigbee2mqtt/external_converters/tuya_hy09_thermostat.js` and then restart Zigbee2MQTT.

## Exposed features

### Climate control
- System mode: `off`, `heat`
- Target (setpoint) temperature  
  - Range: `5–35 °C`
  - Step: `0.5 °C`
- Current room temperature
- Heating running state:
  - `idle`
  - `heat`
- Preset modes:
  - `manual`
  - `auto`
  - `mixed`
  - `holiday`

---

### Scheduling

The thermostat supports weekly scheduling with multiple layout types.

#### Schedule types
- `5+2`
- `6+1`
- `7`

#### Schedule blocks
Each schedule block requires **exactly three periods**:
- Workdays AM
- Workdays PM
- Weekend AM
- Weekend PM

#### Schedule format
Each period must be written in the following format:

```hh:mm/cc.c°C```

Multiple periods are separated by spaces.

**Example (valid schedule block):**

```06:00/21.0°C 12:00/18.0°C 18:00/22.0°C```

---

### Holiday mode
- Holiday duration:
  - Range: `0–365` days
- Holiday target temperature

### Additional configuration
- Child lock
- High temperature protection (enable/disable)
- Low temperature protection (enable/disable)
- High temperature limit
- Low temperature limit
- Hysteresis / deadzone configuration
- Error status reporting