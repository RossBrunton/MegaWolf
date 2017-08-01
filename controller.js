"use strict";

export class Controller {
    constructor() {
        this.control = 0;
        this.latch = 0;
    }
    
    readControl(time) {
        return this.control;
    }
    
    writeControl(value, time) {
        console.log("[controller] Control set to 0x" + value.toString(16));
        this.control = value & 0x7f;
    }
    
    readData(time) {
        return (this.deviceReadData(time) & 0x7f) | this.control | this.latch;
    }
    
    writeData(value, time) {
        if(this.value & 0x80) {
            this.latch = 0x80;
        }else{
            this.latch = 0x00;
        }
        this.deviceWriteData(value & this.control);
    }
    
    
    deviceWriteData(value, time) {
        
    }
    
    deviceReadData(value, time) {
        return 0xff;
    }
}
