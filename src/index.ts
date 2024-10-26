//---------------------------------------------------------------------------------------------------------------------------------

import {DeviceTypeId, Endpoint, Environment, ServerNode, StorageService, Time, VendorId,} from "@matter/main";
import { LevelControlServer } from "@matter/main/behaviors/level-control";
import { TemperatureSensorDevice } from "@matter/main/devices/temperature-sensor";
import { OnOffPlugInUnitDevice } from "@matter/main/devices";
import { DimmablePlugInUnitDevice } from "@matter/main/devices";

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

const COMMAND_PORT = 3000; // 8047;

// Create a UDP socket
const commandClient = dgram.createSocket('udp4');

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
 //  const plugEndpoint = new Endpoint( OnOffPlugInUnitDevice.with(LevelControlServer) , { id: "onoff" });
    const plugEndpoint = new Endpoint( DimmablePlugInUnitDevice, { id: "onoff" });

    await node.add( plugEndpoint );

    // FIXME - should be set from 1st JuiceBox UDP message
    plugEndpoint.set({ levelControl: { minLevel: 1 }}); // FIXME - need to specify feature LT=0 (?) to allow 0 here 
    plugEndpoint.set({ levelControl: { maxLevel: 40 }}); 

    // JuiceBox also reports temperature
    const temperatureEndpoint = new Endpoint(TemperatureSensorDevice, {id: "tempsensor", temperatureMeasurement: {measuredValue: null,},});

    await node.add( temperatureEndpoint );

    plugEndpoint.events.onOff.onOff$Changed.on(value => {
        const m = new Message()   
        m.time = moment();
        // .......
        const builtMessage = m.build();
         // FIXME - send message to JuiciBox
        console.log(`OnOff is now ${value ? "ON" : "OFF"}`);
    });

    plugEndpoint.events.levelControl.currentLevel$Changed.on ( value => {
        const m = new Message()
        
        m.time = moment();
        m.offline_amperage = 20; // FIXME - what shoud go here?
        m.instant_amperage = value ?? 0;
        const builtMessage = m.build();
        console.log("message = " + builtMessage);
        console.log( m.inspect() );

        const message = Buffer.from(builtMessage);

        // Send the message
        commandClient.send(message, 0, message.length, COMMAND_PORT, juiceBoxIP, (err) => {
            if (err) console.error('Error sending message:', err);
            else console.log('Message sent to JuiceBox:', juiceBoxIP, COMMAND_PORT);
        });

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

            console.log('Telnet connection to JuiceBox ');

            // list JuiceBox connections - will parse below when received
            client.write('list\n');
            
            client.on('data', (data: Buffer) => {            
                if ( opened ) { // only if we consider connection open
                    for ( const line of data.toString().split('\n').filter(line => line.trim() !== '') ) {
                        if ( line.includes('UDPC') ) {                         
                            if ( ! line.includes( matterHost ) ) {  // e.g. "# 2 UDPC  jbv1.emotorwerks.com:8042 (13191)"
                                client.write(`close ${line.split(' ')[1]}\nudpc ${matterHost} ${matterPort}\nexit\n`);
                                console.log('UDPC change');                               
                            }
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

function setupUdp( plugEndpoint: Endpoint<DimmablePlugInUnitDevice>, 
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
            plugEndpoint.set({ levelControl: { maxLevel: packet.current_setting }} ); 

            temperatureEndpoint.set({ temperatureMeasurement: { measuredValue: ( packet.temperature - 32) * 5/9 * 100 }}); 
      });
}
//---------------------------------------------------------------------------------------------------------------------------------

async function getConfiguration() {
  /**
   * Collect all needed data
   *
   * This block collects all needed data from cli, environment or storage. Replace this with where ever your data come from.
   */
  const environment = Environment.default;

  const storageService = environment.get(StorageService);
  const deviceStorage = (await storageService.open("device")).createContext("data");


  const deviceName = "Matter JuiceBox";
  const vendorName = "matter-node.js";
  const passcode = environment.vars.number("passcode") ?? (await deviceStorage.get("passcode", 20202021));
  const discriminator = environment.vars.number("discriminator") ?? (await deviceStorage.get("discriminator", 3840));
  // product name / id and vendor id should match what is in the device certificate
  const vendorId = environment.vars.number("vendorid") ?? (await deviceStorage.get("vendorid", 0xfff1));
  const productName = `matter.js JuiceBox`;
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