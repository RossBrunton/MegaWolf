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

const FC = 0x01;
const FN = 0x02;
const FPV = 0x04;
const FH = 0x10;
const FZ = 0x40;
const FS = 0x80;

let BC = 0b00;
let DE = 0b01;
let HL = 0b10;

const DEBUG = false;
let log = function(msg) {
    if(DEBUG) {
        console.log("[Z80_w] "+msg);
    }
}

let isNegative = function(val, length) {
    if(val < 0) return true;
    
    if(length == 1) {
        return (val & 0x80) != 0;
    }else if(length == 2) {
        return (val & 0x8000) != 0;
    }else if(length == 4) {
        return (val & 0x80000000) != 0;
    }else{
        console.error("Unknown length for isNegative!");
        return false;
    }
}

let makeSigned = function(val, length) {
    if(val < 0) return val;
    
    if(length == 1) {
        return (val & 0x80) ? val - 0xff - 1 : val;
    }else if(length == 2) {
        return (val & 0x8000) ? val - 0xffff - 1 : val;
    }else if(length == 4) {
        return (val & 0x80000000) ? val - 0xffffffff - 1 : val;
    }else{
        console.error("Unknown length for makeSigned!");
        return val;
    }
}

let lengthMask = function(length) {
    switch(length) {
        case 1:
            return 0xff;
        case 2:
            return 0xffff;
        case 4:
            return 0xffffffff;
        default:
            console.error("Unkown length value "+length+" for lengthMask");
    }
}

let subCf = function(a, b, length, pv) { // a - b
    let f = 0;
    
    let res = (a - b) & lengthMask(length);
    if(res > a) f |= FC;
    f |= FN;
    // TODO: PV properly
    f |= pv ? FPV : 0;
    if((res & 0xf) > (a & 0xf)) f |= FH;
    if(res == 0) f |= FZ;
    if(isNegative(res, length)) f |= FS;
    
    return f;
}

let addCf = function(a, b, length, withCarry) {
    let f = 0;
    
    let carry = (withCarry && (reg8[F] & FC)) ? 1 : 0;
    
    let res = (a + b + carry) & lengthMask(length);
    let resNc = (a + b) & lengthMask(length);
    
    // Carry
    if(carry) {
        if(res <= a) f |= FC;
        if((res & 0xf) <= (a & 0xf)) f |= FH;
    }else{
        if(res < a) f |= FC;
        if((res & 0xf) < (a & 0xf)) f |= FH;
    }
    
    // Overflow
    let highBitMask = 1 << ((length * 8) - 1)
    if((a & b & highBitMask) || (~a & ~b & highBitMask)) {
        if((a & highBitMask) != (resNc & highBitMask)) {
            // Handle the carry bit
            if(carry && res == 0) {
                // We are -1, the carry bit will stop an overflow
            }else{
                f |= FPV;
            }
        }
    }else if(carry) {
        // Carry, see if that will cause an overflow
        if(resNc == (lengthMask(length) >> 1)) {
            // If it's one less than the amount that would cause an OF
            f |= FPV;
        }
    }
    
    if(res == 0) f |= FZ;
    if(isNegative(res, length)) f |= FS;
    
    return f;
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
    
    reg8[A] = reg8[I];
    
    let f = reg8[F] & FC;
    if(!reg8[I]) f |= FZ;
    if(isNegative(reg8[I], 1)) f |= FS;
    // TODO: PV flag
    reg8[F] = f;
};

parentOps[0xed][0x5f] = function(instruction, oldPc) {
    log("> ld a,r");
    time += 9;
    
    reg8[A] = reg8[R];
    
    let f = reg8[F] & FC;
    if(!reg8[R]) f |= FZ;
    if(isNegative(reg8[R], 1)) f |= FS;
    // TODO: PV flag
    reg8[F] = f;
};

parentOps[0xed][0x47] = function(instruction, oldPc) {
    log("> ld i,a");
    time += 9;
    
    reg8[I] = reg8[A];
};

parentOps[0xed][0x4f] = function(instruction, oldPc) {
    log("> ld r,a");
    time += 9;
    
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


// ----
// Exchange, Block Transfer, and Search Group
// ----
rootOps[0xeb] = function(instruction, oldPc) {
    log("> ex de,hl");
    time += 4;
    
    let tmp = getRegPair(DE);
    setRegPair(DE, getRegPair(HL));
    setRegPair(HL, tmp);
};

rootOps[0x08] = function(instruction, oldPc) {
    log("> ex af,af'");
    time += 4;
    
    for(let r of [A, F]) {
        let tmp = reg8[r];
        reg8[r] = reg8[r + PBASE];
        reg8[r + PBASE] = tmp;
    }
};

rootOps[0xd9] = function(instruction, oldPc) {
    log("> exx");
    time += 4;
    
    for(let r of [B, C, D, E, H, L]) {
        let tmp = reg8[r];
        reg8[r] = reg8[r + PBASE];
        reg8[r + PBASE] = tmp;
    }
};

rootOps[0xe3] = function(instruction, oldPc) {
    time += 19;
    
    if(immediate != 0b111) {
        log("> ex (sp),I*");
        time += 4;
        let tmp = reg16[indirect];
        reg16[indirect] = readMemory16(reg16[SP]);
        writeMemory16(reg16[SP], tmp);
    }else{
        log("> ex (sp),hl");
        let tmp = getRegPair(HL);
        setRegPair(HL, readMemory16(reg16[SP]));
        writeMemory16(reg16[SP], tmp);
    }
};

parentOps[0xed][0xa0] = function(instruction, oldPc) {
    time += 16;
    
    log("> ldi");
    writeMemory8(getRegPair(DE), readMemory8(getRegPair(HL)));
    setRegPair(DE, getRegPair(DE) + 1);
    setRegPair(HL, getRegPair(HL) + 1);
    setRegPair(BC, getRegPair(BC) - 1);
    
    let f = reg8[F] & (FC | FS | FZ);
    if(getRegPair(BC)) f |= FPV;
    reg8[F] = f;
};

parentOps[0xed][0xb0] = function(instruction, oldPc) {
    log("> ldir");
    parentOps[0xed][0xa0](instruction, oldPc); // Call the ldi instruction
    
    // Check its flags
    if(reg8[F] & FPV) {
        time += 5;
        reg16[PC] -= 2;
    }
};

parentOps[0xed][0xa8] = function(instruction, oldPc) {
    time += 16;
    
    log("> ldd");
    writeMemory8(getRegPair(DE), readMemory8(getRegPair(HL)));
    setRegPair(DE, getRegPair(DE) - 1);
    setRegPair(HL, getRegPair(HL) - 1);
    setRegPair(BC, getRegPair(BC) - 1);
    
    let f = reg8[F] & (FC | FS | FZ);
    if(getRegPair(BC)) f |= FPV;
    reg8[F] = f;
};

parentOps[0xed][0xb8] = function(instruction, oldPc) {
    log("> lddr");
    parentOps[0xed][0xa8](instruction, oldPc); // Call the ldd instruction
    
    // Check its flags
    if(reg8[F] & FPV) {
        time += 5;
        reg16[PC] -= 2;
    }
};

parentOps[0xed][0xa1] = function(instruction, oldPc) {
    time += 16;
    
    log("> cpi");
    let val = readMemory8(getRegPair(HL));
    setRegPair(HL, getRegPair(HL) + 1);
    setRegPair(BC, getRegPair(BC) - 1);
    
    reg8[F] = subCf(reg8[A], val, 1, (getRegPair(BC) > 0));
};

parentOps[0xed][0xb1] = function(instruction, oldPc) {
    log("> cpir");
    parentOps[0xed][0xa1](instruction, oldPc); // Call the cpi instruction
    
    // Check its flags
    if((reg8[F] & FPV) || (reg8[Z] & FZ)) {
        time += 5;
        reg16[PC] -= 2;
    }
};

parentOps[0xed][0xa9] = function(instruction, oldPc) {
    time += 16;
    
    log("> cpd");
    let val = readMemory8(getRegPair(HL));
    setRegPair(HL, getRegPair(HL) - 1);
    setRegPair(BC, getRegPair(BC) - 1);
    
    reg8[F] = subCf(reg8[A], val, 1, (getRegPair(BC) > 0));
};

parentOps[0xed][0xb9] = function(instruction, oldPc) {
    log("> cpdr");
    parentOps[0xed][0xa9](instruction, oldPc); // Call the cpi instruction
    
    // Check its flags
    if((reg8[F] & FPV) || (reg8[Z] & FZ)) {
        time += 5;
        reg16[PC] -= 2;
    }
};

// ----
// 8-Bit Arithmetic Group
// ----

let getArg = function(instruction, opName) {
    let src = instruction & 0b111;
    
    if(src == 0b110) {
        log("> "+opName+" a,(*)");
        time += 3;
        if(indirect != 0b111) time += 12;
        return readMemory8(getIndirect() + getIndirectDisplacement());
    }else{
        log("> "+opName+" a,r");
        return reg8[src];
    }
}

fillMask(0x80, 0x07, rootOps, (instruction, oldPc) => {
    time += 4;
    
    let val = getArg(instruction, "add");
    
    reg8[F] = addCf(val, reg8[A], 1, false);
    reg8[A] += val;
});

rootOps[0xc6] = function(instruction, oldPc) {
    log("> add a,n");
    time += 7;
    
    let val = pcAndAdvance(1);
    
    reg8[F] = addCf(val, reg8[A], 1, false);
    reg8[A] += val;
};

fillMask(0x88, 0x07, rootOps, (instruction, oldPc) => {
    time += 4;
    
    let val = getArg(instruction, "adc");
    
    reg8[F] = addCf(val, reg8[A], 1, false);
    reg8[A] += val;
    if(reg8[F] & FC) reg8[A] ++;
});

rootOps[0xce] = function(instruction, oldPc) {
    log("> adc a,n");
    time += 7;
    
    let val = pcAndAdvance(1);
    
    reg8[F] = addCf(val, reg8[A], 1, true);
    reg8[A] += val;
    if(reg8[F] & FC) reg8[A] ++;
};

fillMask(0x90, 0x07, rootOps, (instruction, oldPc) => {
    time += 4;
    
    let val = getArg(instruction, "sub");
    
    reg8[F] = subCf(reg8[A], val, 1, 0, true);
    reg8[A] -= val;
});

rootOps[0xd6] = function(instruction, oldPc) {
    log("> sub a,n");
    time += 7;
    
    let val = pcAndAdvance(1);
    
    reg8[F] = subCf(reg8[A], val, 1, 0, false);
    reg8[A] -= val;
};

fillMask(0x98, 0x07, rootOps, (instruction, oldPc) => {
    time += 4;
    
    let val = getArg(instruction, "sbc");
    
    reg8[F] = subCf(reg8[A], val, 1, 0, true);
    reg8[A] -= val;
    if(reg8[F] & FC) reg8[A] --;
});

rootOps[0xde] = function(instruction, oldPc) {
    log("> sbc a,n");
    time += 7;
    
    let val = pcAndAdvance(1);
    
    reg8[F] = subCf(reg8[A], val, 1, 0, true);
    reg8[A] -= val;
    if(reg8[F] & FC) reg8[A] --;
};

fillMask(0xa0, 0x07, rootOps, (instruction, oldPc) => {
    time += 4;
    
    let val = getArg(instruction, "and");
    reg8[A] &= val;
    
    let f = FH;
    if(isNegative(reg8[A], 1)) f |= FN;
    if(!reg8[A]) f |= FZ;
    // TODO: PV flag
    reg8[F] = f;
});

rootOps[0xe6] = function(instruction, oldPc) {
    log("> and a,n");
    time += 7;
    
    let val = pcAndAdvance(1);
    reg8[A] &= val;
    
    let f = FH;
    if(isNegative(reg8[A], 1)) f |= FN;
    if(!reg8[A]) f |= FZ;
    // TODO: PV flag
    reg8[F] = f;
};

fillMask(0xb0, 0x07, rootOps, (instruction, oldPc) => {
    time += 4;
    
    let val = getArg(instruction, "or");
    reg8[A] |= val;
    
    let f = FH;
    if(isNegative(reg8[A], 1)) f |= FN;
    if(!reg8[A]) f |= FZ;
    // TODO: PV flag
    reg8[F] = f;
});

rootOps[0xf6] = function(instruction, oldPc) {
    log("> or a,n");
    time += 7;
    
    let val = pcAndAdvance(1);
    reg8[A] |= val;
    
    let f = 0;
    if(isNegative(reg8[A], 1)) f |= FN;
    if(!reg8[A]) f |= FZ;
    // TODO: PV flag
    reg8[F] = f;
};

fillMask(0xaf, 0x07, rootOps, (instruction, oldPc) => {
    time += 4;
    
    let val = getArg(instruction, "xor");
    reg8[A] ^= val;
    
    let f = FH;
    if(isNegative(reg8[A], 1)) f |= FN;
    if(!reg8[A]) f |= FZ;
    // TODO: PV flag
    reg8[F] = f;
});

rootOps[0xee] = function(instruction, oldPc) {
    log("> xor a,n");
    time += 7;
    
    let val = pcAndAdvance(1);
    reg8[A] ^= val;
    
    let f = 0;
    if(isNegative(reg8[A], 1)) f |= FN;
    if(!reg8[A]) f |= FZ;
    // TODO: PV flag
    reg8[F] = f;
};

fillMask(0xbf, 0x07, rootOps, (instruction, oldPc) => {
    time += 4;
    
    let val = getArg(instruction, "cp");
    
    reg8[F] = subCf(reg8[A], val, 1, 0, true);
});

rootOps[0xfe] = function(instruction, oldPc) {
    log("> cp a,n");
    time += 7;
    
    let val = pcAndAdvance(1);
    
    reg8[F] = subCf(reg8[A], val, 1, 0, false);
};

fillMask(0x04, 0x38, rootOps, (instruction, oldPc) => {
    time += 4;
    
    let src = (instruction >> 3) & 0b111;
    let val = 0;
    
    if(src == 0b110) {
        log("> inc (*)");
        time += 7;
        if(indirect != 0b111) time += 12;
        val = readMemory8(getIndirect() + getIndirectDisplacement());
        writeMemory8(getIndirect() + getIndirectDisplacement(), val + 1);
    }else{
        log("> inc r");
        val = reg8[src];
        reg8[src] ++;
    }
    
    reg8[F] = addCf(val, 1, 1, false);
});

fillMask(0x05, 0x38, rootOps, (instruction, oldPc) => {
    time += 4;
    
    let src = (instruction >> 3) & 0b111;
    let val = 0;
    
    if(src == 0b110) {
        log("> dec (*)");
        time += 7;
        if(indirect != 0b111) time += 12;
        val = readMemory8(getIndirect() + getIndirectDisplacement());
        writeMemory8(getIndirect() + getIndirectDisplacement(), val - 1);
    }else{
        log("> dec r");
        val = reg8[src];
        reg8[src] --;
    }
    
    reg8[F] = subCf(val, 1, 1, 0, false);
});
