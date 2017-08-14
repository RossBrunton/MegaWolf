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
let crashed = false;

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
    
    if(stopped || crashed) {
        // Stopped, do nothing
        time = worldTime;
    }else{
        // Otherwise, run instructions to make up the difference
        while(time < worldTime) {
            doInstruction();
        }
    }
};

let readMemory8 = function(i) {
    if(i < 0x4000) {
        // RAM
        i &= 0x1fff;
        return ram.getUint8(i);
    }
    
    console.error("[Z80_w] Invalid memory read 0x"+i.toString(16));
    return 0;
};

let readMemory16 = function(i) {
    if(i < 0x4000) {
        // RAM
        i &= 0x1fff;
        return ram.getUint16(i, true);
    }
    
    console.error("[Z80_w] Invalid memory read 0x"+i.toString(16));
    return 0;
};

let readMemoryN = function(i, n) {
    if(n == 1) {
        return readMemory8(i);
    }else{
        return readMemory16(i);
    }
};

let writeMemory8 = function(i, val) {
    if(i < 0x4000) {
        // RAM
        i &= 0x1fff;
        ram.setUint8(i, val);
    }
    
    console.error("[Z80_w] Invalid memory write 0x"+i.toString(16));
};

let writeMemory16 = function(i, val) {
    if(i < 0x4000) {
        // RAM
        i &= 0x1fff;
        ram.setUint16(i, val, true);
    }
    
    console.error("[Z80_w] Invalid memory write 0x"+i.toString(16));
};

let writeMemoryN = function(i, val, n) {
    if(n == 1) {
        writeMemory8(i, val);
    }else{
        writeMemory16(i, val);
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
    let toRet;
    if(length == 1) {
        toRet = readMemory8(reg16[PC]);
        reg16[PC] += 1;
    }else{
        toRet = pcAndAdvance(1);
        toRet |= pcAndAdvance(1) << 8;
    }
    return toRet;
};

let doInstruction = function() {
    // Get the first word of the opcode
    let oldPc = reg16[PC];
    let first = pcAndAdvance(1);
    
    // Clear indirect options
    indirect = 0b111;
    
    // Set indirect
    if(first == 0xdd) {
        indirect = IX;
        first = pcAndAdvance(1);
    }else if(first == 0xfd) {
        indirect = IY;
        first = pcAndAdvance(1);
    }
    
    if(first in rootOps) {
        rootOps[first](first, oldPc);
    }else if(first in parentOps) {
        let second = pcAndAdvance(1);
        if(second in parentOps[first]) {
            parentOps[first][second](second, oldPc);
        }else{
            console.error("[z80] Illegal second word found 0x"+first.toString(16) + ":"+second.toString(16));
            crashed = true;
        }
    }else{
        console.error("[z80] Illegal first word found 0x"+first.toString(16));
        crashed = true;
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

parentOps[0xed] = {};

// And this is the list of opcodes which have no parents
let rootOps = {};

rootOps[0x00] = function(instruction, oldPc) {
    log("> nop");
    time += 4;
};

rootOps[0xe9] = function(instruction, oldPc) {
    log("> jp (hl)");
    time += 4;
    
    reg16[PC] = getRegPair(HL);
};

// Indirects: Some instructions use HL, IX or IY depending on the first word of the instruction, this handles all three
//  at once as part of the instruction decoding
let indirect = 0b111; // IX, IY or 0b111 (to indicate none)
let getIndirect = function() {
    if(indirect == 0b111) {
        return getRegPair(HL);
    }else{
        return reg16[indirect];
    }
}

let getIndirectDisplacement = function() {
    if(indirect == 0b111) {
        return 0;
    }else{
        return pcAndAdvance(1);
    }
};

// ----
// 8-bit load group
// ----

fillMask(0x40, 0x3f, rootOps, (instruction, oldPc) => {
    time += 4;
    
    let dest = (instruction >> 3) & 0b111;
    let src = instruction & 0b111;
    
    if(src == 0b110) {
        log("> ld r,(*)");
        reg8[dest] = readMemory8(getIndirect() + getIndirectDisplacement());
    }else if(dest = 0b110) {
        log("> ld (*),r");
        writeMemory8(getIndirect() + getIndirectDisplacement(), reg8[src]);
    }else{
        log("> ld r,r'");
        reg8[dest] = reg8[src];
    }
});

fillMask(0x06, 0x38, rootOps, (instruction, oldPc) => {
    log("> ld r,n");
    time += 7;
    
    let dest = (instruction >> 3) & 0b111;
    let src = pcAndAdvance(1);
    
    reg8[dest] = src;
});

rootOps[0x36] = function(instruction, oldPc) {
    log("> ld (*),n");
    time += 10;
    
    let n = pcAndAdvance(1);
    
    writeMemory8(getIndirect() + getIndirectDisplacement(), n);
};

rootOps[0x0a] = function(instruction, oldPc) {
    log("> ld a,(bc)");
    time += 7;
    
    reg8[A] = readMemory8(getRegPair(BC));
};

rootOps[0x1a] = function(instruction, oldPc) {
    log("> ld a,(de)");
    time += 7;
    
    reg8[A] = readMemory8(getRegPair(DE));
};

rootOps[0x3a] = function(instruction, oldPc) {
    log("> ld a,(nn)");
    time += 13;
    
    let n = pcAndAdvance(2);
    
    reg8[A] = readMemory8(n);
};

rootOps[0x02] = function(instruction, oldPc) {
    log("> ld (bc),a");
    time += 7;
    
    writeMemory8(getRegPair(BC), reg8[A]);
};

rootOps[0x12] = function(instruction, oldPc) {
    log("> ld (de),a");
    time += 7;
    
    writeMemory8(getRegPair(DE), reg8[A]);
};

rootOps[0x32] = function(instruction, oldPc) {
    log("> ld (nn),a");
    time += 13;
    
    let n = pcAndAdvance(2);
    
    writeMemory8(n, reg8[A]);
};

parentOps[0xed][0x57] = function(instruction, oldPc) {
    log("> ld a,i");
    time += 9;
    
    // TODO: Flags
    reg8[A] = reg8[I];
};

parentOps[0xed][0x5f] = function(instruction, oldPc) {
    log("> ld a,r");
    time += 9;
    
    // TODO: Flags
    reg8[A] = reg8[R];
};

parentOps[0xed][0x47] = function(instruction, oldPc) {
    log("> ld i,a");
    time += 9;
    
    // TODO: Flags
    reg8[I] = reg8[A];
};

parentOps[0xed][0x4f] = function(instruction, oldPc) {
    log("> ld r,a");
    time += 9;
    
    // TODO: Flags
    reg8[R] = reg8[A];
};

// ----
// 16-bit load group
// ----

fillMask(0x01, 0x30, rootOps, (instruction, oldPc) => {
    time += 10;
    
    let dest = (instruction >> 4) & 0b11;
    let n = pcAndAdvance(2);
    
    if(dest == 0b10 && indirect != 0b111) {
        log("> ld I*,nn");
        time += 4;
        reg16[indirect] = n;
    }else{
        log("> ld dd,nn");
        setRegPair(dest, n);
    }
});

rootOps[0x2a] = function(instruction, oldPc) {
    time += 16;
    
    let n = pcAndAdvance(2);
    
    if(indirect != 0b111) {
        log("> ld I*,(nn)");
        time += 4;
        reg16[indirect] = readMemory16(n);
    }else{
        log("> ld HL,(nn)");
        setRegPair(HL, readMemory16(n));
    }
};

fillMask(0x4b, 0x30, parentOps[0xed], (instruction, oldPc) => {
    time += 20;
    
    let dest = (instruction >> 4) & 0b11;
    let n = pcAndAdvance(2);
    
    log("> ld dd,(nn)");
    setRegPair(dest, readMemory16(n));
});

rootOps[0x22] = function(instruction, oldPc) {
    time += 16;
    
    let n = pcAndAdvance(2);
    
    if(indirect != 0b111) {
        log("> ld (nn),I*");
        time += 4;
        writeMemory16(n, reg16[indirect]);
    }else{
        log("> ld (nn),HL");
        writeMemory16(n, getRegPair(HL));
    }
};

fillMask(0x43, 0x30, parentOps[0xed], (instruction, oldPc) => {
    time += 20;
    
    let src = (instruction >> 4) & 0b11;
    let n = pcAndAdvance(2);
    
    log("> ld (nn),dd");
    writeMemory16(n, getRegPair(src));
});

rootOps[0xf9] = function(instruction, oldPc) {
    time += 6;
    
    let n = pcAndAdvance(2);
    
    if(indirect != 0b111) {
        log("> ld (nn),I*");
        time += 4;
        reg16[SP] = reg16[indirect];
    }else{
        log("> ld (nn),HL");
        reg16[SP] = getRegPair(HL);
    }
};

fillMask(0xc5, 0x30, parentOps[0xed], (instruction, oldPc) => {
    time += 11;
    
    let n = pcAndAdvance(2);
    let q = (instruction >> 4) & 0b11;
    let val = 0;
    
    if(q == 0b10 && indirect != 0b111) {
        log("> push I*");
        time += 4;
        val = reg16[indirect];
    }else{
        log("> push qq");
        val = getRegPair(q);
    }
    
    reg16[SP] -= 2;
    writeMemory16(reg16[SP], val);
});

fillMask(0xc1, 0x30, parentOps[0xed], (instruction, oldPc) => {
    time += 10;
    
    let n = pcAndAdvance(2);
    let q = (instruction >> 4) & 0b11;
    let val = readMemory16(reg16[SP]);
    reg16[SP] += 2;
    
    if(q == 0b10 && indirect != 0b111) {
        log("> pop I*");
        time += 4;
        reg16[indirect] = val;
    }else{
        log("> pop qq");
        setRegPair(q, val);
    }
});
