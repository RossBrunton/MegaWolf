"use strict";

export class Controller {
    constructor() {
        this.control = 0;
        this.latch = 0;
        this.lastDataWrite = 0x0000;
    }
    
    readControl(time) {
        return this.control;
    }
    
    writeControl(value, time) {
        console.log("[controller] Control set to 0x" + value.toString(16));
        this.control = value & 0x7f;
    }
    
    readData(time) {
        return ((this.deviceReadData(time) & ~this.control & 0x7f) | (this.lastDataWrite & this.control) | this.latch) & 0xff;
    }
    
    writeData(value, time) {
        if(value & 0x80) {
            this.latch = 0x80;
        }else{
            this.latch = 0x00;
        }
        this.deviceWriteData(value & this.control);
        this.lastDataWrite = value & this.control;
    }
    
    
    deviceWriteData(value, time) {
        
    }
    
    deviceReadData(value, time) {
        return 0xff;
    }
}
