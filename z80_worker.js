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

const A = 0b111;
const B = 0b000;
const C = 0b001;
const D = 0b010;
const E = 0b011;
const H = 0b100;
const L = 0b101;
const F = 0b110;
const PBASE = 0b1000;
const I = 0b10001;
const R = 0b10010;

const IX = 0b00;
const IY = 0b01;
const SP = 0b10;
const PC = 0b11;

let BC = 0b00;
let DE = 0b01;
let HL = 0b10;

const DEBUG = false;
let log = function(msg) {
    if(DEBUG) {
        console.log("[Z80_w] "+msg);
    }
}

self.onmessage = function(e) {
    let data = e.data[1];
    
    switch(e.data[0]) {
        case MSG_INIT:
            shared = new Uint32Array(data[0]);
            options = data[1];
            ram = new DataView(data[2]);
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
            reg16[PC] = 0x0000;
            break;
        
        default:
            console.error("Z80 worker got unknown message type "+e.data[0]);
            break;
    }
}

let shared = null;
let stopped = true;
let options = null;
let ram = null;
let time = 0;
let worldTime = 0; // Time here is in Z80 clock cycles

let reg8 = new Uint8Array(R + 1);
let reg16 = new Uint16Array(PC + 1);

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

let getMemory8 = function(i) {
    if(i < 0x4000) {
        // Memory
        i &= 0x1fff;
        return ram.getUint8(i);
    }
    
    console.error("[Z80_w] Invalid memory read 0x"+i.toString(16));
    return 0;
};

let getMemory16 = function(i) {
    
};

let getMemoryN = function(i, n) {
    if(n == 1) {
        return getMemory8(i);
    }else{
        return getMemory16(i);
    }
};

let getRegPair = function(pair) {
    switch(pair) {
        case BC:
            return (reg8[B] << 8) | reg8[C];
        case DE:
            return (reg8[D] << 8) | reg8[E];
        case HL:
            return (reg8[H] << 8) | reg8[L];
        case 0b11: // SP
            return reg16[SP];
    }
};

let setRegPair = function(pair, val) {
    let hi = val >>> 8;
    let lo = val & 0xff;
    
    switch(pair) {
        case BC:
            reg8[B] = hi;
            reg8[C] = lo;
            break;
        case DE:
            reg8[D] = hi;
            reg8[E] = lo;
            break;
        case HL:
            reg8[H] = hi;
            reg8[L] = lo;
            break;
        case 0b11: // SP
            reg16[SP] = val;
            break;
    }
};

let pcAndAdvance = function(length) {
    let toRet = getMemoryN(reg16[PC], length);
    reg16[PC] += length;
    return toRet;
};

let doInstruction = function() {
    // Get the first word of the opcode
    let oldPc = reg16[PC];
    let first = pcAndAdvance(1);
    
    if(first in rootOps) {
        rootOps[first](first, oldPc);
    }else if(first in parentOps) {
        let second = pcAndAdvance(1);
        if(second in parentOps[first]) {
            parentOps[first][second](second, oldPc);
        }else{
            console.error("[z80] Illegal second word found 0x"+first.toString(16) + ":"+second.toString(16));
        }
    }else{
        console.error("[z80] Illegal first word found 0x"+first.toString(16));
    }
};

let fillMask = function(val, mask, parent, fn) { // Fill all possible values of the mask into the parent opcode
    let opts = [0];
    for(var n = 7; n >= 0; n --) {
        let bit = 1 << n;
        if(mask & bit) {
            opts = opts.map(x => (x << 1) | 1).concat(opts.map(x => (x << 1) | 0));
        }else{
            opts = opts.map(x => (x << 1) | ((val & bit) ? 1 : 0));
        }
    }
    
    // Now populate the parent
    opts.forEach(x => parent[x] = fn);
};

// Opcodes
// Parent lists: Each of these has several child opcodes which are the second word
let parentOps = {};

// And this is the list of opcodes which have no parents
let rootOps = {};

rootOps[0x00] = function(instruction, oldPc) {
    log("> nop");
    time += 4;
}

rootOps[0xe9] = function(instruction, oldPc) {
    log("> jp (hl)");
    time += 4;
    
    reg16[PC] = getRegPair(HL);
}
