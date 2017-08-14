"use strict";

const MSG_START = 0;
const MSG_STOP = 1;
const MSG_INIT = 2;
const MSG_RESET = 3;
const MSG_FRAME = 4;

console.log("Z80 Worker Started!");

const CLOCK_PAL = 3546894;
const CLOCK_NTSC = 3579545;
const FPS = 60;

self.onmessage = function(e) {
    let data = e.data[1];
    
    switch(e.data[0]) {
        case MSG_INIT:
            shared = new Uint32Array(data[0]);
            options = data[1];
            break;
        
        case MSG_STOP:
            stopped = true;
            break;
        
        case MSG_START:
            stopped = false;
            break;
        
        case MSG_FRAME:
            doFrame(data[0]);
            break;
        
        case MSG_RESET:
            // reset
            break;
        
        default:
            console.error("Z80 worker got unknown message type "+e.data[0]);
            break;
    }
}

let shared = null;
let stopped = true;
let options = null;
let time = 0;
let worldTime = 0; // Time here is in Z80 clock cycles

let clock = function() {
    if(options.region == "pal") {
        return CLOCK_PAL;
    }else{
        return CLOCK_NTSC;
    }
};

let doFrame = function(factor) {
    worldTime += ((clock() / FPS) * factor)|0;
    
    if(stopped) {
        // Stopped, do nothing
        time = worldTime;
    }else{
        // Otherwise, run instructions to make up the difference
        while(time < worldTime) {
            doInstruction();
        }
    }
};

let doInstruction = function() {
    time += 4;
};
