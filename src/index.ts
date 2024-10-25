
import {
  DeviceTypeId,
  Endpoint,
  EndpointServer,
  Environment,
  ServerNode,
  StorageService,
  Time,
  VendorId,
} from "@matter/main";

import { LevelControlServer } from "@matter/main/behaviors/level-control";
import { TemperatureSensorDevice } from "@matter/main/devices/temperature-sensor";

import { OnOffPlugInUnitDevice } from "@matter/main/devices";
import net from 'net';
import * as dgram from "dgram";
import yargs from "yargs/yargs";

const argv : any = yargs(process.argv).parse();

// host and port of the JuiceBox
const juiceBoxIP = argv.juicebox_host; // e.g. '192.168.1.107'; 
const juiceBoxTelnetPort = argv.juicebox_telnet_port ?? 2000;
const juiceBoxPollSeconds = argv.juicebox_poll_seconds ?? 30;

// host and port of the Matter handler 
const matterHost = argv.matter_host; //'192.168.1.86';
const matterPort = argv.matter_port ?? 8047; 

// TCP socket connection to the JuiceBox server
let client : net.Socket;

// track state of connection as we know it
let opened: boolean = false;
  
/** Initialize configuration values */
const {deviceName,vendorName,passcode, discriminator,vendorId,productName,productId,port,uniqueId,} = await getConfiguration();

   /**
     * Create a Matter ServerNode, which contains the Root Endpoint and all relevant data and configuration
     */
const node = await ServerNode.create({
    // Required: Give the Node a unique ID which is used to store the state of this node
    id: uniqueId,

    // Provide Network relevant configuration like the port
    // Optional when operating only one device on a host, Default port is 5540
    network: {port,  },

    // Provide Commissioning relevant settings
    // Optional for development/testing purposes
    commissioning: { passcode, discriminator, },

    // Provide Node announcement settings
    // Optional: If Ommitted some development defaults are used
    productDescription: { name: deviceName, deviceType: DeviceTypeId(OnOffPlugInUnitDevice.deviceType), },

    // Provide defaults for the BasicInformation cluster on the Root endpoint
    // Optional: If Omitted some development defaults are used
    basicInformation: {
        vendorName,
        vendorId: VendorId(vendorId),
        nodeLabel: productName,
        productName,
        productLabel: productName,
        productId,
        serialNumber: `matterjs-${uniqueId}`,
        uniqueId,
    },
 });

// Create a Matter "endpoint" - a component of a node. Add optional output Level Control 
// there are choices here regarding what type of Matter device(s) or Bridge could be used 
const plugEndpoint = new Endpoint( OnOffPlugInUnitDevice.with(LevelControlServer) , { id: "onoff" });
await node.add( plugEndpoint );

// FIXME - should be set from 1st JuiceBox UDP message
plugEndpoint.set({ levelControl: { minLevel: 0 }}); 
plugEndpoint.set({ levelControl: { maxLevel: 40 }}); 

// JuiceBox also reports temperature
const temperatureEndpoint = new Endpoint(TemperatureSensorDevice, {id: "tempsensor", temperatureMeasurement: {measuredValue: null,},});

await node.add( temperatureEndpoint );

plugEndpoint.events.onOff.onOff$Changed.on(value => {console.log(`OnOff is now ${value ? "ON" : "OFF"}`);});

plugEndpoint.events.levelControl.currentLevel$Changed.on ( value => {
  console.log(`Plug level is now ${value}`);
});

// set up to receive JuiceBox UDP messages
setupUdp( plugEndpoint, temperatureEndpoint ) ;

// call once to initially set UDPC
telnetJuice() ;

// Poll every "juiceBoxPollSeconds" for UDPC correctness
const intervalId = setInterval( telnetJuice, juiceBoxPollSeconds * 1000 );

// Start our Matter server
await node.start();
 
// function to check and possibly change destination of JuiceBox UDP messages
function telnetJuice( ) {

    // if we don't already have an open socket
    if ( ! opened) {
        client = new net.Socket();

        client.connect( juiceBoxTelnetPort, juiceBoxIP, () => {

            client.on('close', () => { console.log('Connection closed'); opened = false; });
            client.on('error', (err: Error) => {console.error('Telnet Error: ', err);});
    
            // from our prespective, connection is open
            opened = true;

            console.log('***************************************** Telnet connection to JuiceBox ');

            // list JuiceBox connections - will parse below when received
            client.write('list\n');
            
            client.on('data', (data: Buffer) => { // response from the server
                
                if ( opened ) { // we only care if we consider connection open
                    const array: string[] = data.toString().split('\n').filter(line => line.trim() !== '');

                    for ( const line of array ) {
                        if ( line.includes('UDPC')  ) {                         
                            if ( !line.includes( matterHost ) ) {
                                // FIXME - should parse out connection handle rather than hard-code '2'
                                client.write(`close 2\nudpc ${matterHost} ${matterPort}\nexit\n`);
                                console.log('Closing connection after UDPC change');                               
                            } else  console.log('Closing connection after no change needed');  

                            opened = false;
                            client.end(); 
                            break;
                        }
                    }
                 }
            });
       });  
    } 
}

function setupUdp( plugEndpoint: Endpoint<OnOffPlugInUnitDevice>, 
    temperatureEndpoint: Endpoint<TemperatureSensorDevice> ) {
  
        var udpserver = dgram.createSocket('udp4');
        udpserver.bind(matterPort);

        // emits on datagram msg
        udpserver.on('message', function (msg: Uint8Array, _info: Uint8Array) {

        let packet: any = basicMessageParse(msg);

        console.log(JSON.stringify(packet, null, 2));

        console.log('Setting onOff to ' + (packet.power > 0));

        // Set Matter attributes
        plugEndpoint.set({ onOff: { onOff: (packet.power > 0)}}); 
    //  plugEndpoint.set({ levelControl: { maxLevel: packet.current_setting }} ); 

        temperatureEndpoint.set({ temperatureMeasurement: { measuredValue: ( packet.temperature - 32) * 5/9 * 100 }}); 
   });
}

// Parse JuiceBox UDP
function basicMessageParse(data: Uint8Array): {
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

  // converted by ChatGPT to Typescript from https://github.com/snicker/juicepassproxy

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
  } = { type: "basic", current: 0, energy_session: 0,  data_from_juicebox: ""  };
  
  let active = true;
  let parts = new TextDecoder("utf-8").decode(data).split(/,|!|:/);
  parts.shift(); // Remove JuiceBox ID - probably should keep this to support multiple JuiceBox
  parts.pop();   // Remove Ending blank
  parts.pop();   // Remove Checksum

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

async function getConfiguration() {
  /**
   * Collect all needed data
   *
   * This block collects all needed data from cli, environment or storage. Replace this with where ever your data come from.
   *
   * Note: This example uses the matter.js process storage system to store the device parameter data for convenience
   * and easy reuse. When you also do that be careful to not overlap with Matter-Server own storage contexts
   * (so maybe better not do it ;-)).
   */
  const environment = Environment.default;

  const storageService = environment.get(StorageService);
  console.log(`Storage location: ${storageService.location} (Directory)`);
  console.log(
      'Use the parameter "--storage-path=NAME-OR-PATH" to specify a different storage location in this directory, use --storage-clear to start with an empty storage.',
  );
  const deviceStorage = (await storageService.open("device")).createContext("data");


  const deviceName = "Matter JuiceBox";
  const vendorName = "matter-node.js";
  const passcode = environment.vars.number("passcode") ?? (await deviceStorage.get("passcode", 20202021));
  const discriminator = environment.vars.number("discriminator") ?? (await deviceStorage.get("discriminator", 3840));
  // product name / id and vendor id should match what is in the device certificate
  const vendorId = environment.vars.number("vendorid") ?? (await deviceStorage.get("vendorid", 0xfff1));
  const productName = `node-matter JuiceBox ${"Socket"}`;
  const productId = environment.vars.number("productid") ?? (await deviceStorage.get("productid", 0x8000));

  const port = environment.vars.number("port") ?? 5540;

  const uniqueId =
      environment.vars.string("uniqueid") ?? (await deviceStorage.get("uniqueid", Time.nowMs())).toString();

  // Persist basic data to keep them also on restart
  await deviceStorage.set({
      passcode,
      discriminator,
      vendorid: vendorId,
      productid: productId,
      uniqueid: uniqueId,
  });

  return {deviceName, vendorName, passcode, discriminator,vendorId, productName, productId, port, uniqueId,};
}