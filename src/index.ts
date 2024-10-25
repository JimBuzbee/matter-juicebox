
//---------------------------------------------------------------------------------------------------------------------------------

import {DeviceTypeId, Endpoint, Environment, ServerNode, StorageService, Time, VendorId,} from "@matter/main";
import { LevelControlServer } from "@matter/main/behaviors/level-control";
import { TemperatureSensorDevice } from "@matter/main/devices/temperature-sensor";
import { OnOffPlugInUnitDevice } from "@matter/main/devices";

import net from 'net';
import * as dgram from "dgram";
import yargs from "yargs/yargs";
import { Message } from "./message.js";
import moment from 'moment';
import { basicMessageParse } from "./basicMessageParse.js";

//---------------------------------------------------------------------------------------------------------------------------------

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
  
//---------------------------------------------------------------------------------------------------------------------------------
async function main() {

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
        const m = new Message()
        
        m.time = moment();
        m.offline_amperage = 20;
        m.instant_amperage = value ?? 0;
        const builtMessage = m.build();
        console.log(builtMessage);
        console.log(m.inspect());

        console.log(`Plug level is now ${value}`);
    });

    // set up to receive JuiceBox UDP messages
    setupUdp( plugEndpoint, temperatureEndpoint ) ;

    // call once to initially set UDPC
    telnetJuiceBox() ;

    // Poll every "juiceBoxPollSeconds" for UDPC correctness
    const intervalId = setInterval( telnetJuiceBox, juiceBoxPollSeconds * 1000 );

    // Start our Matter server
    await node.start();
}
//---------------------------------------------------------------------------------------------------------------------------------

// function to check and possibly change destination of JuiceBox UDP messages
function telnetJuiceBox( ) {

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
//---------------------------------------------------------------------------------------------------------------------------------

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
//---------------------------------------------------------------------------------------------------------------------------------

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

  const uniqueId = environment.vars.string("uniqueid") ?? (await deviceStorage.get("uniqueid", Time.nowMs())).toString();

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

//---------------------------------------------------------------------------------------------------------------------------------

main();