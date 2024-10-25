

// converted by ChatGPT to Typescript from https://github.com/snicker/juicepassproxy

// Parse JuiceBox UDP
export function basicMessageParse(data: Uint8Array): {
    type: string;
    current: number;
    energy_session: number;
    status?: string;
    current_rating?: number;
    current_setting?: number;
    frequency?: number;
    energy_lifetime?: number;
    protocol_version?: string;
    report_time?: string;
    interval?: string;
    loop_counter?: string;
    temperature?: number;
    voltage?: number;
    power?: number;
    data_from_juicebox: string;
    [key: string]: any; // Allows for additional dynamic properties
} {
 

    // Undefined parts: F, e, r, b, B, P, p
    // https://github.com/snicker/juicepassproxy/issues/52
    // s = Counter
    // v = version of protocol
    // i = Interval number. It contains a 96-slot interval memory (15-minute x 24-hour cycle) and
    //  this tells you how much energy was consumed in the rolling window as it reports one past
    //  (or current, if it's reporting the "right-now" interval) interval per message.
    //  The letter after "i" = the energy in that interval (usually 0 if you're not charging basically 24/7)
    //  t - probably the report time in seconds - "every 9 seconds" (or may end up being 10).
    //  It can change its reporting interval if the bit mask in the reply command indicates that it should send reports faster (yet to be determined).
    // u - loop counter
    // sample message
    /*
           {
              "type": "basic",
              "current": 39.7,
              "energy_session": 78,
              "data_from_juicebox": "0910042001280638830123620113:v09u,s001,F11,u00019289,V2350,L00005078518,S02,T20,M0040,C0040,m0040,t09,i58,e-0001,f6001,r99,b000,B0000000,P0,E0000078,A00397,p0997!MD7:",
              "protocol_version": "09u",
              "unknown_s": "001",
              "unknown_F": "11",
              "loop_counter": "00019289",
              "voltage": 235,
              "energy_lifetime": 5078518,
              "status": "Charging",
              "temperature": 68,
              "current_setting": 40,
              "unknown_C": "0040",
              "current_rating": 40,
              "report_time": "09",
              "interval": "58",
              "unknown_e": "-0001",
              "frequency": 60.01,
              "unknown_r": "99",
              "unknown_b": "000",
              "unknown_B": "0000000",
              "unknown_P": "0",
              "unknown_p": "0997",
              "power": 9329.5
          }
      */
    let message: {
        type: string;
        current: number;
        energy_session: number;
        status?: string;
        current_rating?: number;
        current_setting?: number;
        frequency?: number;
        energy_lifetime?: number;
        protocol_version?: string;
        report_time?: string;
        interval?: string;
        loop_counter?: string;
        temperature?: number;
        voltage?: number;
        power?: number;
        data_from_juicebox: string;
        [key: string]: any;
    } = { type: "basic", current: 0, energy_session: 0, data_from_juicebox: "" };

    let active = true;
    let parts = new TextDecoder("utf-8").decode(data).split(/,|!|:/);
    parts.shift(); // Remove JuiceBox ID - probably should keep this to support multiple JuiceBox
    parts.pop(); // Remove Ending blank
    parts.pop(); // Remove Checksum

    for (let part of parts) {
        switch (part[0]) {
            case "S":
                message["status"] = {
                    "S0": "Unplugged",
                    "S1": "Plugged In",
                    "S2": "Charging",
                    "S5": "Error",
                    "S00": "Unplugged",
                    "S01": "Plugged In",
                    "S02": "Charging",
                    "S05": "Error"
                }[part] || `unknown ${part}`;
                active = message["status"].toLowerCase() === "charging";
                break;
            case "A":
                message["current"] = active ? +(parseFloat(part.split("A")[1]) * 0.1).toFixed(2) : 0;
                break;
            case "m":
                message["current_rating"] = parseFloat(part.split("m")[1]);
                break;
            case "M":
                message["current_setting"] = parseFloat(part.split("M")[1]);
                break;
            case "f":
                message["frequency"] = +(parseFloat(part.split("f")[1]) * 0.01).toFixed(2);
                break;
            case "L":
                message["energy_lifetime"] = parseFloat(part.split("L")[1]);
                break;
            case "v":
                message["protocol_version"] = part.split("v")[1];
                break;
            case "E":
                message["energy_session"] = active ? parseFloat(part.split("E")[1]) : 0;
                break;
            case "t":
                message["report_time"] = part.split("t")[1];
                break;
            case "i":
                message["interval"] = part.split("i")[1];
                break;
            case "u":
                message["loop_counter"] = part.split("u")[1];
                break;
            case "T":
                message["temperature"] = +(parseFloat(part.split("T")[1]) * 1.8 + 32).toFixed(2);
                break;
            case "V":
                message["voltage"] = +(parseFloat(part.split("V")[1]) * 0.1).toFixed(2);
                break;
            default:
                message[`unknown_${part[0]}`] = part.substring(1);
        }
    }

    if (message.voltage !== undefined && message.current !== undefined) {
        message["power"] = +(message.voltage * message.current).toFixed(2);
    } else {
        message["power"] = 0; // Default value if voltage or current are undefined
    }

    message["data_from_juicebox"] = new TextDecoder("utf-8").decode(data);

    return message;
}
