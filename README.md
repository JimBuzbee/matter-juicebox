# Initial proof-of-concept showing representation of a JuiceBox EV Charger with a Matter interface. 
Initially the impementiation just shows status, but more can be done by sending commands to the JuiceBox and by using
additional Matter interfaces to show more data.

The Matter standard defines an EVSE (Electric Vehicle Supply Equipment) device, but as 
of Fall 2024, none of the standard Matter controllers such as Google, Apple, Alexa, Home Assistant, etc. support it. And similarlly 
Matter provides for a Device Energy Management device, but again support is limited. For this implementation, I utilize a simple
socket device with level control to represent the output setting for the charger. And I add a Matter temperature sensor to show
the reported temperature of the JuiceBox. Unfortunately, the only controller I have seen that supports the optional level control 
for the socket is Home Assistant. Google, Apple, and SmartThings all ignore it. Alexa shows the control, but either my implementation
is fawed, or Alexa doesn't handle it properly. It is hoped that as time goes by, more support will come to these controllers.

My implementation is mostly glue-code using matter.js (https://github.com/project-chip/matter.js) and 
JuiceBoxProxy (https://github.com/JuiceRescue/juicepassproxy) code that has been converted to Typescript by ChatGPT.  Thanks to the
hard work from these folks

Also of note: I would not recommend running this code continuously. The interface to the JuiceBox has been reverse engineerd and it
not completly understood yet. There may be hidden side effects such as writes to the internal EEPROM that could cause wear and tear.


## Running

If you have [Node.js](https://nodejs.org/) installed you can run yourself:

```
git clone https://github.com/JimBuzbee/matter-juicebox.git
cd matter-device
npm install
```

Edit the run.sh file to change IP address and then execute it. When the QR code appears on the screen, scan it like 
any other Matter device in using your chosen Matter controller. You'll likely get a warning regarding an uncertified
device. Accept or not. For complete Matter command-line options see: https://github.com/project-chip/matter.js/tree/main/packages/examples

![JuiceBox Display Using Home Assistant](screenshot.png "JuiceBox Display Using Home Assistant")



