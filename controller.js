"use strict";

let DEBUG = false;
let log = function(msg) {
    if(DEBUG) {
        console.log("[controller] " + msg);
    }
}

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
        log("Control set to 0x" + value.toString(16));
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
    
    deviceReadData(time) {
        return 0xff;
    }
}

const A = 0;
const B = 1;
const C = 2;
const START = 3;
const UP = 4;
const DOWN = 5;
const LEFT = 6;
const RIGHT = 7;
export class Gamepad3 extends Controller {
    constructor(a, b, c, s) {
        super();
        
        this.maps = [a, b, c, s, 38, 40, 37, 39];
        this.held = [false, false, false, false, false, false, false, false];
        
        document.addEventListener("keydown", this.keyDown.bind(this));
        document.addEventListener("keyup", this.keyUp.bind(this));
    }
    
    deviceWriteData(value, time) {
        // Do nothing
    }
    
    deviceReadData(time) {
        if(this.lastDataWrite & 0x40) {
            // TH = 1
            let out = 0;
            if(!this.held[UP]) out |= 0x01;
            if(!this.held[DOWN]) out |= 0x02;
            if(!this.held[LEFT]) out |= 0x04;
            if(!this.held[RIGHT]) out |= 0x08;
            if(!this.held[B]) out |= 0x10;
            if(!this.held[C]) out |= 0x20;
            return out;
        }else{
            // TH = 0
            let out = 0;
            if(!this.held[UP]) out |= 0x01;
            if(!this.held[DOWN]) out |= 0x02;
            if(!this.held[A]) out |= 0x10;
            if(!this.held[START]) out |= 0x20;
            return out;
        }
    }
    
    keyDown(e) {
        if(this.maps.includes(e.keyCode)) {
            this.held[this.maps.indexOf(e.keyCode)] = true;
        }
    }
    
    keyUp(e) {
        if(this.maps.includes(e.keyCode)) {
            this.held[this.maps.indexOf(e.keyCode)] = false;
        }
    }
}
