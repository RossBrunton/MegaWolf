"use strict";

const MSG_START = 0;
const MSG_STOP = 1;
const MSG_INIT = 2;
const MSG_RESET = 3;
const MSG_FRAME = 4;
const MSG_NEWROM = 5;

// Bus release/acquire
const MSG_RELEASE = 6;
const MSG_RELEASE_ACK = 7;
const MSG_ACQUIRE = 8;
const MSG_ACQUIRE_ACK = 9;

const MSG_DOIO = 10;

const SHM_IO = 0;
const SHM_DATA = 1;
const SHM_ADDR = 2;
const SHM_BANK = 3; // Memory bank, converted such that it can just be ORed with the access
const SHM_INT = 4; // Interrupt

const MEM_NONE = 0; // Memory bus: SHM_IO is set by the worker depending on the operation, which is then cleared by the
const MEM_READ = 1; //  main Z80 class
const MEM_WRITE = 2;
const MEM_IOREAD = 3;
const MEM_IOWRITE = 4;
const MEM_ICLR = 5;

const MODE_MD = "md"; // Mega drive
const MODE_MS = "ms"; // Master system

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
const I = 0b10000;
const R = 0b10001;

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
let AF = 0b11;

let IM0 = 0b00;
let IM1 = 0b01;
let IM2 = 0b10;

let logp = 0;
let logEntries = [];
let memLogP = 0;
const DEBUG = false;
const LOGGING = true;
const LOG_ENTRIES = 500;
const TRACE_STATE = true;
let memLogEntries = new Uint8Array(LOG_ENTRIES + 1);
let state = new Uint8Array(0b10010);
let state16 = new Uint16Array(0b100);
let heat = {};
let log = function(msg) {
    if(DEBUG) {
        console.log("[Z80_w] " + msg);
    }
    
    if(!LOGGING) return;
    logp += 1;
    logp %= LOG_ENTRIES;
    logEntries[logp] = msg;
};

const TRACE_STACK = true;
let stack = new Uint16Array(500);
let stackP = 0;
let addStack = (() => {});
let popStack = (() => {});
if(TRACE_STACK) {
    addStack = function(addr) {
        stack[stackP ++] = addr;
    }

    popStack = function() {
        stackP --;
    }
}

let dumpStack = function() {
    for(let x = 0; x < stackP; x ++) {
        console.log("> 0x" + stack[x].toString(16));
    }
}

let markHeat = function(opcode) {
    if(!LOGGING) return;
    
    if(!(opcode in heat)) heat[opcode] = 0;
    heat[opcode] ++;
}

let memLog = function(mem) {
    if(!LOGGING) return;
    memLogP += 1;
    memLogP %= LOG_ENTRIES;
    memLogEntries[memLogP] = mem;
};

let dumpLog = function() {
    if(!LOGGING) {
        console.log("Logging disabled...");
    }else{
        for(let i = logp; (i != logp +1) && !(logp == LOG_ENTRIES && i == 0); (i != 0) ? i -- : i = LOG_ENTRIES) {
            console.log(logEntries[i]);
        }
    }
};

let dumpMemLog = function() {
    if(!LOGGING) {
        console.log("Logging disabled...");
    }else{
        let ostr = "";
        for(let i = memLogP; (i != memLogP +1) && !(memLogP == LOG_ENTRIES && i == 0);
            (i != 0) ? i -- : i = LOG_ENTRIES) {
            ostr = (memLogEntries[i] <= 0xf ? "0" : "") + memLogEntries[i].toString(16) + " " + ostr;
        }
        return ostr;
    }
};

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
};

let makeSigned = function(val, length) {
    if(val < 0) return val;
    val &= lengthMask(length);
    
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
};

let parity = function(val, length) {
    //TODO: Calculate parity
    return 0;
};

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
            return 0x0;
    }
};

// pv: 0 or 1 is literal, 2 is "calculate it"
let subCf = function(a, b, length, pv, withCarry) { // a - b
    let f = 0;
    
    let res = (a - b) & lengthMask(length);
    if(res > a) f |= FC;
    f |= FN;
    // TODO: PV properly
    if(pv === 2) {
        f |= pv ? FPV : 0;
    }else{
        // Calculate
    }
    if((res & 0xf) > (a & 0xf)) f |= FH;
    if(res == 0) f |= FZ;
    if(isNegative(res, length)) f |= FS;
    
    return f;
};

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
};

let regString = function(r) {
    return ["B", "C", "D", "E", "H", "L", "F", "A",
        "B'", "C'", "D'", "E'", "H'", "L'", "F'", "A'",
        "I", "R"][r];
};

let regPairString = function(p, af) {
    return ["BC", "DE", "HL", !af ? "SP" : "AF"][p];
};

let reg16String = function(p) {
    return ["IX", "IY", "SP", "PC"][p];
};

let flagStr = function(f) {
    let str = "";
    str += (f & FS) ? "S" : "-";
    str += (f & FZ) ? "Z" : "-";
    str += (f & FH) ? "H" : "-";
    str += (f & FPV) ? "V" : "-";
    str += (f & FN) ? "N" : "-";
    str += (f & FC) ? "C" : "-";
    return str;
};

let printHeat = function() {
    let results = Object.entries(heat).sort((a, b) => b[1] - a[1]);
    
    for(let [op, heat] of results) {
        if(heat) console.log("%s: "+heat, op.toString(16));
    }
};

self.onmessage = function(e) {
    let data = e.data[1];
    
    switch(e.data[0]) {
        case MSG_INIT:
            shared = new Int32Array(data[0]);
            options = data[1];
            ram = new DataView(data[2]);
            break;
        
        case MSG_NEWROM:
            rom = new DataView(data[0]);
            mode = data[1];
            
            if(mode == MODE_MS) {
                // In SMS mode, we cannot be stopped and always have the bus
                stopped = false;
                hasBus = true;
                reset(0x0000);
            }
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
            reset(0x0000);
            break;
        
        case MSG_RELEASE:
            hasBus = false;
            self.postMessage([MSG_RELEASE_ACK, []]);
            break;
        
        case MSG_ACQUIRE:
            hasBus = true;
            self.postMessage([MSG_ACQUIRE_ACK, []]);
            break;
        
        default:
            console.error("Z80 worker got unknown message type "+e.data[0]);
            break;
    }
};

let shared = null;
let stopped = true;
let hasBus = true;
let options = null;
let ram = null;
let rom = null;
let time = 0;
let worldTime = 0; // Time here is in Z80 clock cycles
let crashed = false;
let halted = false;
let iff1 = 0; // Interupt flip flops
let iff2 = 0;
let interruptCooldown = 0; // Interrupts may not arrive until the instruction after the ei one
let intMode = IM0; // Interrupt mode
let mode = MODE_MD;

let msBanks = [0x0, 0x0, 0x0]; // Master system bank numbers, ready for oring with addresses

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
    
    if(stopped || crashed || halted || !hasBus) {
        // Stopped, do nothing
        time = worldTime;
    }else{
        // Otherwise, run instructions to make up the difference
        while(time < worldTime) {
            doInstruction();
        }
    }
};

let romOffset = function(addr) {
    if(addr < 0x400) {
        // Unpaged
        return addr;
    }else if(addr < 0x4000) {
        // Page 0
        return msBanks[0] | (addr & 0x3fff);
    }else if(addr < 0x8000) {
        // Page 1
        return msBanks[1] | (addr & 0x3fff);
    }else{
        // Page 2
        return msBanks[2] | (addr & 0x3fff);
    }
}

let readMemory8 = function(i) {
    if(mode == MODE_MD) {
        if(i < 0x4000) {
            // RAM
            i &= 0x1fff;
            return ram.getUint8(i);
        }
        
        Atomics.store(shared, SHM_ADDR, i);
        Atomics.store(shared, SHM_IO, MEM_READ);
        self.postMessage([MSG_DOIO, null]);
        Atomics.wait(shared, SHM_IO, MEM_READ);
        return shared[SHM_DATA];
    }else{
        if(i < 0xc000) {
            // ROM
            return rom.getUint8(romOffset(i));
        }
        
        if(i >= 0xc000 && i < 0xfff0) {
            // RAM
            i &= 0x1fff;
            return ram.getUint8(i);
        }
        
        if(i == 0xfffc) {
            // Mapper settings
            // TODO: this
            console.warn("Read from mapper settings");
            return 0;
        }
        
        if(i >= 0xfffd) {
            return msBanks[i - 0xfffd] >>> 14;
        }
        
        console.warn("Read from unknown address " + i.toString(16));
    }
};

let readMemory16 = function(i) {
    if(mode == MODE_MD) {
        if(i < 0x4000) {
            // RAM
            i &= 0x1fff;
            return ram.getUint16(i, true);
        }
        
        return (readMemory8(i + 1) << 8) | readMemory8(i);
    }else{
        if(i < 0xc000) {
            // ROM
            return rom.getUint16(romOffset(i), true);
        }
        
        if(i >= 0xc000 && i < 0xfff0) {
            // RAM
            i &= 0x1fff;
            return ram.getUint16(i, true);
        }
        
        console.warn("Read from unknown address " + i.toString(16));
    }
};

let readMemoryN = function(i, n) {
    if(n == 1) {
        return readMemory8(i);
    }else{
        return readMemory16(i);
    }
};

let writeMemory8 = function(i, val) {
    if(mode == MODE_MD) {
        if(i < 0x4000) {
            // RAM
            i &= 0x1fff;
            ram.setUint8(i, val);
            return;
        }
        
        Atomics.store(shared, SHM_DATA, val);
        Atomics.store(shared, SHM_ADDR, i);
        Atomics.store(shared, SHM_IO, MEM_WRITE);
        self.postMessage([MSG_DOIO, null]);
        Atomics.wait(shared, SHM_IO, MEM_WRITE);
    }else{
        if(i < 0xc000) {
            // ROM
            console.error("Attempted ROM write at " + i.toString(16));
            return;
        }
        
        if(i >= 0xc000 && i < 0xfff0) {
            // RAM
            i &= 0x1fff;
            if(i > reg16[SP] + 2 && reg16[SP]) debugger;
            ram.setUint8(i, val);
            return;
        }
        
        if(i == 0xfffc) {
            // Mapper settings
            // TODO: this
            console.warn("Write to mapper settings");
            return;
        }
        
        if(i >= 0xfffd) {
            msBanks[i - 0xfffd] = (val & 0xf) << 14;
            return;
        }
        
        console.warn("Write to unknown address " + i.toString(16));
    }
};

let writeMemory16 = function(i, val) {
    if(mode == MODE_MD) {
        if(i < 0x4000) {
            // RAM
            i &= 0x1fff;
            ram.setUint16(i, val, true);
            return;
        }
        
        let hi = val >>> 8;
        let lo = val & 0xff;
        writeMemory8(i + 1, hi);
        writeMemory8(i, lo);
    }else{
        if(i < 0xbfff) {
            // ROM
            console.error("Attempted ROM write at " + i.toString(16));
            return;
        }
        
        if(i >= 0xc000 && i < 0xfff0) {
            // RAM
            i &= 0x1fff;
            if(i > reg16[SP] + 2 && reg16[SP]) debugger;
            ram.setUint16(i, val, true);
            return;
        }
        
        console.warn("Write to unknown address " + i.toString(16));
    }
};

let writeMemoryN = function(i, val, n) {
    if(n == 1) {
        writeMemory8(i, val);
    }else{
        writeMemory16(i, val);
    }
};

let getRegPair = function(pair, af) {
    switch(pair) {
        case BC:
            return (reg8[B] << 8) | reg8[C];
        case DE:
            return (reg8[D] << 8) | reg8[E];
        case HL:
            return (reg8[H] << 8) | reg8[L];
        case 0b11: // SP or AF
            if(af) {
                return (reg8[A] << 8) | reg8[F];
            }
            return reg16[SP];
    }
};

let setRegPair = function(pair, val, af) {
    let hi = (val >>> 8) & 0xff;
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
        case 0b11: // SP or AF
            if(af) {
                reg8[A] = hi;
                reg8[F] = lo;
            }else{
                reg16[SP] = val;
            }
            break;
    }
};

let pcAndAdvance = function(length) {
    let toRet;
    if(length == 1) {
        toRet = readMemory8(reg16[PC]);
        memLog(toRet);
        reg16[PC] += 1;
    }else{
        toRet = pcAndAdvance(1);
        let hi = pcAndAdvance(1);
        toRet |= hi << 8;
    }
    return toRet;
};

let reset = function(entry) {
    halted = false;
    crashed = false;
    iff1 = 0;
    iff2 = 0;
    reg16[PC] = entry;
    msBanks = [0x0000, 0x4000, 0x8000];
};

let portIn = function(port) {
    Atomics.store(shared, SHM_ADDR, port);
    Atomics.store(shared, SHM_IO, MEM_IOREAD);
    self.postMessage([MSG_DOIO, null]);
    Atomics.wait(shared, SHM_IO, MEM_IOREAD);
    
    return shared[SHM_DATA];
};

let portOut = function(port, value) {
    Atomics.store(shared, SHM_DATA, value);
    Atomics.store(shared, SHM_ADDR, port);
    Atomics.store(shared, SHM_IO, MEM_IOWRITE);
    self.postMessage([MSG_DOIO, null]);
    Atomics.wait(shared, SHM_IO, MEM_IOWRITE);
};

let interrupt = function() {
    log(" ---- Got Interrupt ----");
    
    switch(intMode) {
        case IM0:
            console.log("IM0 not supported yet");
            break;
        
        case IM1:
            // Restart
            reg16[SP] -= 2;
            writeMemory16(reg16[SP], reg16[PC]);
            addStack(reg16[PC]);
            
            reg16[PC] = 0x38;
            break;
        
        case IM2:
            console.log("IM2 not supported yet");
            break;
        
        default:
            console.error("Unknown interrupt mode " + intMode);
    }
}

let doInstruction = function() {
    // Get the first word of the opcode
    let oldPc = reg16[PC];
    let first = pcAndAdvance(1);
    
    // Clear indirect options
    indirect = 0b111;
    indirectDispSet = false;
    
    // System state
    if(TRACE_STATE) {
        for(let i = 0; i < reg8.length; i ++) {
            if(state[i] != reg8[i]) {
                if(i == F) {
                    log("["+regString(i)+"] "+flagStr(state[i])+" -> "+flagStr(reg8[i]));
                }else{
                    log("["+regString(i)+"] 0x"+state[i].toString(16)+" -> 0x"+reg8[i].toString(16));
                }
                state[i] = reg8[i];
            }
        }
        
        for(let i = 0; i < reg16.length; i ++) {
            if(state16[i] != reg16[i]) {
                log("["+reg16String(i)+"] 0x"+state16[i].toString(16)+" -> 0x"+reg16[i].toString(16));
                state16[i] = reg16[i];
            }
        }
    }
    
    // Check for interrupts
    // (DI (0xf3) disables interrupts during its execution)
    if(shared[SHM_INT] && !interruptCooldown && iff1 && first != 0xf3) {
        Atomics.store(shared, SHM_IO, MEM_ICLR);
        Atomics.wait(shared, SHM_IO, MEM_ICLR);
        
        reg16[PC] = oldPc;
        interrupt();
        return;
    }else if(interruptCooldown) {
        interruptCooldown --;
    }
    
    // Set indirect
    if(first == 0xdd) {
        indirect = IX;
        first = pcAndAdvance(1);
        log("Using IX as indirect");
    }else if(first == 0xfd) {
        indirect = IY;
        first = pcAndAdvance(1);
        log("Using IY as indirect");
    }
    
    if(first in rootOps) {
        log("Running instruction 0x"+first.toString(16)+" at 0x"+oldPc.toString(16));
        rootOps[first](first, oldPc);
    }else if(first in parentOps) {
        // Now the indirect (if set) comes
        getIndirectDisplacement();
        let second = pcAndAdvance(1);
        if(second in parentOps[first]) {
            log("Running instruction 0x"+first.toString(16)+":"+second.toString(16)+" at 0x"+oldPc.toString(16));
            parentOps[first][second](second, oldPc);
        }else{
            console.error("[Z80_w] Illegal second word found 0x"+first.toString(16) + ":"+second.toString(16));
            crashed = true;
        }
    }else{
        console.error("[Z80_w] Illegal first word found 0x"+first.toString(16));
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
    opts.forEach(x => {
        if(parent[x]) console.error("Clobber on opcode address 0x" + x.toString(16));
        parent[x] = fn;
    });
};

// Opcodes
// Parent lists: Each of these has several child opcodes which are the second word
let parentOps = {};

parentOps[0xed] = {};
parentOps[0xcb] = {};

// And this is the list of opcodes which have no parents
let rootOps = {};

// Indirects: Some instructions use HL, IX or IY depending on the first word of the instruction, this handles all three
//  at once as part of the instruction decoding
let indirect = 0b111; // IX, IY or 0b111 (to indicate none)
let indirectDisp = 0;
let indirectDispSet = false;
let getIndirect = function() {
    if(indirect == 0b111) {
        return getRegPair(HL);
    }else{
        return reg16[indirect];
    }
};

let setIndirect = function(v) {
    if(indirect == 0b111) {
        setRegPair(HL, v);
    }else{
        reg16[indirect] = v;
    }
};

let getIndirectDisplacement = function() {
    if(indirect == 0b111) {
        return 0;
    }else{
        if(!indirectDispSet) {
            indirectDisp = makeSigned(pcAndAdvance(1), 1);
            indirectDispSet = true;
        }
        return indirectDisp;
    }
};

let indirectString = function() {
    if(indirect == 0b111) return "HL";
    return ["IX", "IY"][indirect];
}

// ----
// 8-bit load group
// ----

fillMask(0x40, 0x3f, rootOps, (instruction, oldPc) => {
    time += 4;
    markHeat("ld");
    
    let dest = (instruction >> 3) & 0b111;
    let src = instruction & 0b111;
    
    if(src == 0b110) {
        log("> ld " + regString(dest) + ",(" + indirectString() + " + d)");
        reg8[dest] = readMemory8(getIndirect() + getIndirectDisplacement());
    }else if(dest == 0b110) {
        log("> ld (" + indirectString() + " + d)," + regString(src));
        writeMemory8(getIndirect() + getIndirectDisplacement(), reg8[src]);
    }else{
        log("> ld " + regString(dest) + "," + regString(src));
        reg8[dest] = reg8[src];
    }
});

fillMask(0x06, 0x38, rootOps, (instruction, oldPc) => {
    log("> ld r,n");
    markHeat("ld");
    time += 7;
    
    let dest = (instruction >> 3) & 0b111;
    let src = pcAndAdvance(1);
    
    reg8[dest] = src;
});

rootOps[0x36] = function(instruction, oldPc) {
    time += 10;
    markHeat("ld");
    
    getIndirectDisplacement();
    let n = pcAndAdvance(1);
    log("> ld (" + indirectString() +" + d),#$" + n.toString(16));
    
    writeMemory8(getIndirect() + getIndirectDisplacement(), n);
};

rootOps[0x0a] = function(instruction, oldPc) {
    log("> ld a,(bc)");
    time += 7;
    markHeat("ld");
    
    reg8[A] = readMemory8(getRegPair(BC));
};

rootOps[0x1a] = function(instruction, oldPc) {
    log("> ld a,(de)");
    time += 7;
    markHeat("ld");
    
    reg8[A] = readMemory8(getRegPair(DE));
};

rootOps[0x3a] = function(instruction, oldPc) {
    log("> ld a,(nn)");
    time += 13;
    markHeat("ld");
    
    let n = pcAndAdvance(2);
    
    reg8[A] = readMemory8(n);
};

rootOps[0x02] = function(instruction, oldPc) {
    log("> ld (bc),a");
    time += 7;
    markHeat("ld");
    
    writeMemory8(getRegPair(BC), reg8[A]);
};

rootOps[0x12] = function(instruction, oldPc) {
    log("> ld (de),a");
    time += 7;
    markHeat("ld");
    
    writeMemory8(getRegPair(DE), reg8[A]);
};

rootOps[0x32] = function(instruction, oldPc) {
    time += 13;
    markHeat("ld");
    
    let n = pcAndAdvance(2);
    log("> ld ($#" + n.toString(16) + "),A");
    
    writeMemory8(n, reg8[A]);
};

parentOps[0xed][0x57] = function(instruction, oldPc) {
    log("> ld A,I");
    time += 9;
    markHeat("ld");
    
    reg8[A] = reg8[I];
    
    let f = reg8[F] & FC;
    if(!reg8[I]) f |= FZ;
    if(isNegative(reg8[I], 1)) f |= FS;
    if(iff2) f |= FPV;
    reg8[F] = f;
};

parentOps[0xed][0x5f] = function(instruction, oldPc) {
    log("> ld A,R");
    time += 9;
    markHeat("ld");
    
    reg8[A] = reg8[R];
    
    let f = reg8[F] & FC;
    if(!reg8[R]) f |= FZ;
    if(isNegative(reg8[R], 1)) f |= FS;
    if(iff2) f |= FPV;
    reg8[F] = f;
};

parentOps[0xed][0x47] = function(instruction, oldPc) {
    log("> ld I,A");
    time += 9;
    markHeat("ld");
    
    reg8[I] = reg8[A];
};

parentOps[0xed][0x4f] = function(instruction, oldPc) {
    log("> ld R,A");
    time += 9;
    
    reg8[R] = reg8[A];
};

// ----
// 16-bit load group
// ----

fillMask(0x01, 0x30, rootOps, (instruction, oldPc) => {
    time += 10;
    markHeat("ld(16)");
    
    let dest = (instruction >> 4) & 0b11;
    let n = pcAndAdvance(2);
    
    if(dest == 0b10 && indirect != 0b111) {
        log("> ld " + indirectString() + ",#$" + n.toString(16));
        time += 4;
        reg16[indirect] = n;
    }else{
        log("> ld " + regPairString(dest) + ",#$" + n.toString(16));
        setRegPair(dest, n);
    }
});

rootOps[0x2a] = function(instruction, oldPc) {
    time += 16;
    markHeat("ld(16)");
    
    let n = pcAndAdvance(2);
    
    if(indirect != 0b111) {
        log("> ld " + indirectString() + ",(#$" + n.toString(16) + ")");
        time += 4;
        reg16[indirect] = readMemory16(n);
    }else{
        log("> ld HL,(#$" + n.toString(16) + ")");
        setRegPair(HL, readMemory16(n));
    }
};

fillMask(0x4b, 0x30, parentOps[0xed], (instruction, oldPc) => {
    time += 20;
    markHeat("ld(16)");
    
    let dest = (instruction >> 4) & 0b11;
    let n = pcAndAdvance(2);
    
    log("> ld dd,(nn)");
    setRegPair(dest, readMemory16(n));
});

rootOps[0x22] = function(instruction, oldPc) {
    time += 16;
    markHeat("ld(16)");
    
    let n = pcAndAdvance(2);
    
    log("> ld (#$" + n.toString(16) + ")," + indirectString());
    if(indirect != 0b111) {
        time += 4;
        writeMemory16(n, reg16[indirect]);
    }else{
        writeMemory16(n, getRegPair(HL));
    }
};

fillMask(0x43, 0x30, parentOps[0xed], (instruction, oldPc) => {
    time += 20;
    markHeat("ld(16)");
    
    let src = (instruction >> 4) & 0b11;
    let n = pcAndAdvance(2);
    
    log("> ld (#$" + n.toString(16) + ")," + regPairString(src));
    writeMemory16(n, getRegPair(src));
});

rootOps[0xf9] = function(instruction, oldPc) {
    time += 6;
    markHeat("ld(16)");
    
    log("> ld SP," + indirectString());
    if(indirect != 0b111) {
        time += 4;
        reg16[SP] = reg16[indirect];
    }else{
        reg16[SP] = getRegPair(HL);
    }
};

fillMask(0xc5, 0x30, rootOps, (instruction, oldPc) => {
    time += 11;
    markHeat("push");
    
    let q = (instruction >> 4) & 0b11;
    let val = 0;
    
    if(q == 0b10 && indirect != 0b111) {
        log("> push " + indirectString());
        time += 4;
        val = reg16[indirect];
    }else{
        log("> push " + regPairString(q, true));
        val = getRegPair(q, true);
    }
    
    reg16[SP] -= 2;
    writeMemory16(reg16[SP], val);
});

fillMask(0xc1, 0x30, rootOps, (instruction, oldPc) => {
    time += 10;
    markHeat("pop");
    
    let q = (instruction >> 4) & 0b11;
    let val = readMemory16(reg16[SP]);
    reg16[SP] += 2;
    
    if(q == 0b10 && indirect != 0b111) {
        log("> pop " + indirectString());
        time += 4;
        reg16[indirect] = val;
    }else{
        log("> pop " + regPairString(q, true));
        setRegPair(q, val, true);
    }
});


// ----
// Exchange, Block Transfer, and Search Group
// ----
rootOps[0xeb] = function(instruction, oldPc) {
    log("> ex DE,HL");
    markHeat("ex");
    time += 4;
    
    let tmp = getRegPair(DE);
    setRegPair(DE, getRegPair(HL));
    setRegPair(HL, tmp);
};

rootOps[0x08] = function(instruction, oldPc) {
    log("> ex AF,AF'");
    time += 4;
    markHeat("ex");
    
    for(let r of [A, F]) {
        let tmp = reg8[r];
        reg8[r] = reg8[r + PBASE];
        reg8[r + PBASE] = tmp;
    }
};

rootOps[0xd9] = function(instruction, oldPc) {
    log("> exx");
    time += 4;
    markHeat("exx");
    
    for(let r of [B, C, D, E, H, L]) {
        let tmp = reg8[r];
        reg8[r] = reg8[r + PBASE];
        reg8[r + PBASE] = tmp;
    }
};

rootOps[0xe3] = function(instruction, oldPc) {
    time += 19;
    markHeat("ex");
    
    if(indirect != 0b111) {
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
    markHeat("ldi");
    
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
    markHeat("ldir");
    parentOps[0xed][0xa0](instruction, oldPc); // Call the ldi instruction
    
    // Check its flags
    if(reg8[F] & FPV) {
        time += 5;
        reg16[PC] -= 2;
    }
};

parentOps[0xed][0xa8] = function(instruction, oldPc) {
    time += 16;
    markHeat("ldd");
    
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
    markHeat("lddr");
    parentOps[0xed][0xa8](instruction, oldPc); // Call the ldd instruction
    
    // Check its flags
    if(reg8[F] & FPV) {
        time += 5;
        reg16[PC] -= 2;
    }
};

parentOps[0xed][0xa1] = function(instruction, oldPc) {
    time += 16;
    markHeat("cpi");
    
    log("> cpi");
    let val = readMemory8(getRegPair(HL));
    setRegPair(HL, getRegPair(HL) + 1);
    setRegPair(BC, getRegPair(BC) - 1);
    
    reg8[F] = subCf(reg8[A], val, 1, (getRegPair(BC) > 0) ? 1 : 0, false);
};

parentOps[0xed][0xb1] = function(instruction, oldPc) {
    log("> cpir");
    markHeat("cpir");
    parentOps[0xed][0xa1](instruction, oldPc); // Call the cpi instruction
    
    // Check its flags
    if((reg8[F] & FPV) && !(reg8[Z] & FZ)) {
        time += 5;
        reg16[PC] -= 2;
    }
};

parentOps[0xed][0xa9] = function(instruction, oldPc) {
    time += 16;
    markHeat("cpd");
    
    log("> cpd");
    let val = readMemory8(getRegPair(HL));
    setRegPair(HL, getRegPair(HL) - 1);
    setRegPair(BC, getRegPair(BC) - 1);
    
    reg8[F] = subCf(reg8[A], val, 1, (getRegPair(BC) > 0) ? 1 : 0, false);
};

parentOps[0xed][0xb9] = function(instruction, oldPc) {
    log("> cpdr");
    markHeat("cpdr");
    parentOps[0xed][0xa9](instruction, oldPc); // Call the cpi instruction
    
    // Check its flags
    if((reg8[F] & FPV) && !(reg8[Z] & FZ)) {
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
        log("> " + opName+" A,(" + indirectString() + " + d)");
        time += 3;
        if(indirect != 0b111) time += 12;
        return readMemory8(getIndirect() + getIndirectDisplacement());
    }else{
        log("> "+opName+" A,"+regString(src));
        return reg8[src];
    }
}

fillMask(0x80, 0x07, rootOps, (instruction, oldPc) => {
    time += 4;
    markHeat("add");
    
    let val = getArg(instruction, "add");
    
    reg8[F] = addCf(val, reg8[A], 1, false);
    reg8[A] += val;
});

rootOps[0xc6] = function(instruction, oldPc) {
    log("> add a,n");
    time += 7;
    markHeat("add");
    
    let val = pcAndAdvance(1);
    
    reg8[F] = addCf(val, reg8[A], 1, false);
    reg8[A] += val;
};

fillMask(0x88, 0x07, rootOps, (instruction, oldPc) => {
    time += 4;
    markHeat("adc");
    
    let val = getArg(instruction, "adc");
    let c = reg8[F] & FC;
    
    reg8[F] = addCf(val, reg8[A], 1, false);
    reg8[A] += val;
    if(c) reg8[A] ++;
});

rootOps[0xce] = function(instruction, oldPc) {
    log("> adc a,n");
    time += 7;
    markHeat("adc");
    
    let val = pcAndAdvance(1);
    let c = reg8[F] & FC;
    
    reg8[F] = addCf(val, reg8[A], 1, true);
    reg8[A] += val;
    if(c) reg8[A] ++;
};

fillMask(0x90, 0x07, rootOps, (instruction, oldPc) => {
    time += 4;
    markHeat("sub");
    
    let val = getArg(instruction, "sub");
    
    reg8[F] = subCf(reg8[A], val, 1, 2, false);
    reg8[A] -= val;
});

rootOps[0xd6] = function(instruction, oldPc) {
    log("> sub a,n");
    time += 7;
    markHeat("sub");
    
    let val = pcAndAdvance(1);
    
    reg8[F] = subCf(reg8[A], val, 1, 2, false);
    reg8[A] -= val;
};

fillMask(0x98, 0x07, rootOps, (instruction, oldPc) => {
    time += 4;
    markHeat("sbc");
    
    let val = getArg(instruction, "sbc");
    let c = reg8[F] & FC;
    
    reg8[F] = subCf(reg8[A], val, 1, 2, true);
    reg8[A] -= val;
    if(c) reg8[A] --;
});

rootOps[0xde] = function(instruction, oldPc) {
    log("> sbc a,n");
    time += 7;
    markHeat("sbc");
    
    let val = pcAndAdvance(1);
    let c = reg8[F] & FC;
    
    reg8[F] = subCf(reg8[A], val, 1, 2, true);
    reg8[A] -= val;
    if(c) reg8[A] --;
};

fillMask(0xa0, 0x07, rootOps, (instruction, oldPc) => {
    time += 4;
    markHeat("and");
    
    let val = getArg(instruction, "and");
    reg8[A] &= val;
    
    let f = FH;
    if(isNegative(reg8[A], 1)) f |= FS;
    if(!reg8[A]) f |= FZ;
    // TODO: PV flag
    reg8[F] = f;
});

rootOps[0xe6] = function(instruction, oldPc) {
    time += 7;
    markHeat("and");
    
    let val = pcAndAdvance(1);
    reg8[A] &= val;
    log("> and A,#$" + val.toString(16));
    
    let f = FH;
    if(isNegative(reg8[A], 1)) f |= FS;
    if(!reg8[A]) f |= FZ;
    // TODO: PV flag
    reg8[F] = f;
};

fillMask(0xb0, 0x07, rootOps, (instruction, oldPc) => {
    time += 4;
    markHeat("or");
    
    let val = getArg(instruction, "or");
    reg8[A] |= val;
    
    let f = FH;
    if(isNegative(reg8[A], 1)) f |= FS;
    if(!reg8[A]) f |= FZ;
    // TODO: PV flag
    reg8[F] = f;
});

rootOps[0xf6] = function(instruction, oldPc) {
    time += 7;
    markHeat("or");
    
    let val = pcAndAdvance(1);
    reg8[A] |= val;
    
    log("> or A,#$" + val.toString(16));
    
    let f = 0;
    if(isNegative(reg8[A], 1)) f |= FS;
    if(!reg8[A]) f |= FZ;
    // TODO: PV flag
    reg8[F] = f;
};

fillMask(0xaf, 0x07, rootOps, (instruction, oldPc) => {
    time += 4;
    markHeat("xor");
    
    let val = getArg(instruction, "xor");
    reg8[A] ^= val;
    
    let f = FH;
    if(isNegative(reg8[A], 1)) f |= FS;
    if(!reg8[A]) f |= FZ;
    if(parity(reg8[A], 1)) f |= FPV;
    reg8[F] = f;
});

rootOps[0xee] = function(instruction, oldPc) {
    time += 7;
    markHeat("xor");
    
    let val = pcAndAdvance(1);
    reg8[A] ^= val;
    
    log("> xor A,#$" + val.toString(16));
    
    let f = 0;
    if(isNegative(reg8[A], 1)) f |= FS;
    if(!reg8[A]) f |= FZ;
    if(parity(reg8[A], 1)) f |= FPV;
    reg8[F] = f;
};

fillMask(0xbf, 0x07, rootOps, (instruction, oldPc) => {
    time += 4;
    markHeat("cp");
    
    let val = getArg(instruction, "cp");
    
    reg8[F] = subCf(reg8[A], val, 1, 2, false);
});

rootOps[0xfe] = function(instruction, oldPc) {
    time += 7;
    markHeat("cp");
    
    let val = pcAndAdvance(1);
    log("> cp A,#$" + val.toString(16));
    
    reg8[F] = subCf(reg8[A], val, 1, 2, false);
};

fillMask(0x04, 0x38, rootOps, (instruction, oldPc) => {
    time += 4;
    markHeat("inc");
    
    let src = (instruction >> 3) & 0b111;
    let val = 0;
    
    if(src == 0b110) {
        log("> inc (" + indirectString() + " + d)");
        time += 7;
        if(indirect != 0b111) time += 12;
        val = readMemory8(getIndirect() + getIndirectDisplacement());
        writeMemory8(getIndirect() + getIndirectDisplacement(), val + 1);
    }else{
        log("> inc " + regString(src));
        val = reg8[src];
        reg8[src] ++;
    }
    
    reg8[F] = addCf(val, 1, 1, false);
});

fillMask(0x05, 0x38, rootOps, (instruction, oldPc) => {
    time += 4;
    markHeat("dec");
    
    let src = (instruction >> 3) & 0b111;
    let val = 0;
    
    if(src == 0b110) {
        log("> dec (" + indirectString() + " + d)");
        time += 7;
        if(indirect != 0b111) time += 12;
        val = readMemory8(getIndirect() + getIndirectDisplacement());
        writeMemory8(getIndirect() + getIndirectDisplacement(), val - 1);
    }else{
        log("> dec " + regString(src));
        val = reg8[src];
        reg8[src] --;
    }
    
    reg8[F] = subCf(val, 1, 1, 2, false);
});


// ----
// General-Purpose Arithmetic and CPU Control Groups
// ----

rootOps[0x27] = function(instruction, oldPc) {
    log("> daa");
    markHeat("daa");
    console.error("[Z80_w] daa operator not implemented yet.");
    crashed = true;
};

rootOps[0x2f] = function(instruction, oldPc) {
    log("> cpl");
    time += 4;
    markHeat("cpl");
    
    reg8[A] = ~reg8[A];
    reg8[F] |= FH | FN;
};

parentOps[0xed][0x44] = function(instruction, oldPc) {
    log("> neg");
    time += 8;
    markHeat("neg");
    
    reg8[A] = -reg8[A];
    reg8[F] = subCf(0, reg8[A], 1, 2, false);
};

rootOps[0x3f] = function(instruction, oldPc) {
    log("> ccf");
    time += 4;
    markHeat("ccf");
    
    let oldC = (reg8[F] & FC) != 0;
    reg8[F] &= ~(FC | FH | FN);
    if(oldC) {
        reg8[F] |= FH;
    }else{
        reg8[F] |= FC;
    }
};

rootOps[0x37] = function(instruction, oldPc) {
    log("> scf");
    time += 4;
    markHeat("scf");
    
    reg8[F] &= ~(FH | FN);
    reg8[F] |= FC;
};

rootOps[0x00] = function(instruction, oldPc) {
    log("> nop");
    time += 4;
    markHeat("nop");
};

rootOps[0x76] = function(instruction, oldPc) {
    log("> halt");
    time += 4;
    markHeat("halt");
    
    halted = true;
};

rootOps[0xf3] = function(instruction, oldPc) {
    log("> di");
    time += 4;
    markHeat("di");
    
    iff1 = 0;
    iff2 = 0;
};

rootOps[0xfb] = function(instruction, oldPc) {
    log("> ei");
    time += 4;
    markHeat("ei");
    
    iff1 = 1;
    iff2 = 1;
    interruptCooldown = 1;
};

fillMask(0x46, 0x18, parentOps[0xed], (instruction, oldPc) => {
    time += 8;
    markHeat("im");
    
    intMode = (instruction >> 3) & 0b11;
    
    if(intMode > 0) intMode --;
    log("> im " + intMode);
});

// ----
// 16-Bit Arithmetic Group
// ----

fillMask(0x09, 0x30, rootOps, (instruction, oldPc) => {
    log("> add hl,ss");
    time += 11;
    markHeat("add(16)");
    let base;
    let src;
    let reg = (instruction >> 4) & 0b11;
    
    if(reg == 0b10 && indirect != 0b111) {
        // IX/IY
        time += 4;
        src = getIndirect();
    }else{
        // Any other pair
        src = getRegPair(reg);
    }
    
    let val = getIndirect() + src;
    reg8[F] = addCf(getIndirect(), src, 2, false);
    
    setIndirect(val);
});

fillMask(0x4a, 0x30, parentOps[0xed], (instruction, oldPc) => {
    log("> adc hl,ss");
    time += 15;
    markHeat("adc(16)");
    let reg = (instruction >> 4) & 0b11;
    
    let src = getRegPair(reg);
    
    let val = getRegPair(HL) + src + ((reg8[F] & FC) ? 1 : 0);
    reg8[F] = addCf(getRegPair(HL), src, 2, true);
    
    setRegPair(HL, val);
});

fillMask(0x42, 0x30, parentOps[0xed], (instruction, oldPc) => {
    log("> sbc hl,ss");
    time += 15;
    markHeat("sbc(16)");
    let reg = (instruction >> 4) & 0b11;
    
    let src = getRegPair(reg);
    
    let val = getRegPair(HL) - src - ((reg8[F] & FC) ? 1 : 0);
    reg8[F] = subCf(getRegPair(HL), src, 2, true);
    
    setRegPair(HL, val);
});

fillMask(0x03, 0x30, rootOps, (instruction, oldPc) => {
    time += 6;
    markHeat("inc(16)");
    let base;
    let src;
    let reg = (instruction >> 4) & 0b11;
    
    if(reg == 0b10 && indirect != 0b111) {
        // IX/IY
        time += 4;
        src = getIndirect();
        log("> inc " + indirectString());
    }else{
        // Any other pair
        src = getRegPair(reg);
        log("> inc " + regPairString(reg));
    }
    
    let val = src + 1;
    
    if(reg == 0b10 && indirect != 0b111) {
        // IX/IY
        setIndirect(val);
    }else{
        // Any other pair
        setRegPair(reg, val);
    }
});

fillMask(0x0b, 0x30, rootOps, (instruction, oldPc) => {
    time += 6;
    markHeat("dec(16)");
    let base;
    let src;
    let reg = (instruction >> 4) & 0b11;
    
    if(reg == 0b10 && indirect != 0b111) {
        // IX/IY
        time += 4;
        src = getIndirect();
        log("> dec " + indirectString());
    }else{
        // Any other pair
        src = getRegPair(reg);
        log("> dec " + regPairString(reg));
    }
    
    let val = src - 1;
    
    if(reg == 0b10 && indirect != 0b111) {
        // IX/IY
        setIndirect(val);
    }else{
        // Any other pair
        setRegPair(reg, val);
    }
});


// ----
// Rotate and Shift Group
// ----

let shiftGet = function(instruction) {
    let reg = instruction & 0b111;
    
    if(reg == 0b110) {
        // Memory
        time += 7;
        if(indirect != 0b111) time += 8;
        return readMemory8(getIndirect() + getIndirectDisplacement());
    }else{
        // Register
        return reg8[reg];
    }
}

let shiftSet = function(instruction, value, c) {
    let reg = instruction & 0b111;
    
    if(reg == 0b110) {
        // Memory
        writeMemory8(getIndirect() + getIndirectDisplacement(), value);
    }else{
        // Register
        reg8[reg] = value;
    }
    
    // Set flags
    reg8[F] = 0;
    if(c) reg8[F] |= FC;
    if(!value) reg8[F] |= FZ;
    if(isNegative(value, 1)) reg8[F] |= FS;
    if(parity(value, 1)) reg8[F] |= FPV;
}

rootOps[0x07] = function(instruction, oldPc) {
    log("> rlca");
    time += 4;
    markHeat("rlca");
    
    let c = reg8[A] >>> 7;
    
    reg8[A] <<= 1;
    reg8[A] |= c;
    
    reg8[F] &= ~(FC | FN | FH);
    if(c) reg8[F] |= FC;
};

rootOps[0x17] = function(instruction, oldPc) {
    log("> rla");
    time += 4;
    markHeat("rla");
    
    let oldC = (reg8[F] & FC) ? 1 : 0;
    let c = reg8[A] >>> 7;
    
    reg8[A] <<= 1;
    reg8[A] |= oldC;
    
    reg8[F] &= ~(FC | FN | FH);
    if(c) reg8[F] |= FC;
};

rootOps[0x0f] = function(instruction, oldPc) {
    log("> rrca");
    time += 4;
    markHeat("rrca");
    
    let c = reg8[A] & 0b1;
    
    reg8[A] >>>= 1;
    reg8[A] |= c << 7;
    
    reg8[F] &= ~(FC | FN | FH);
    if(c) reg8[F] |= FC;
};

rootOps[0x1f] = function(instruction, oldPc) {
    log("> rra");
    time += 4;
    markHeat("rra");
    
    let oldC = (reg8[F] & FC) ? 1 : 0;
    let c = reg8[A] & 0b1;
    
    reg8[A] >>>= 1;
    reg8[A] |= oldC << 7;
    
    reg8[F] &= ~(FC | FN | FH);
    if(c) reg8[F] |= FC;
};

fillMask(0x00, 0x7, parentOps[0xcb], (instruction, oldPc) => {
    log("> rlc m");
    time += 8;
    markHeat("rlc");
    
    let src = shiftGet(instruction);
    let c = src >>> 7;
    
    src <<= 1;
    src |= c;
    
    shiftSet(instruction, src, c);
});

fillMask(0x10, 0x7, parentOps[0xcb], (instruction, oldPc) => {
    log("> rl m");
    time += 8;
    markHeat("rl");
    let oldC = (reg8[F] & FC) ? 1 : 0;
    
    let src = shiftGet(instruction);
    let c = src >>> 7;
    
    src <<= 1;
    src |= oldC;
    
    shiftSet(instruction, src, c);
});

fillMask(0x08, 0x7, parentOps[0xcb], (instruction, oldPc) => {
    log("> rrc m");
    time += 8;
    markHeat("rrc");
    
    let src = shiftGet(instruction);
    let c = src & 0b1;
    
    src >>>= 1;
    src |= c << 7;
    
    shiftSet(instruction, src, c);
});

fillMask(0x18, 0x7, parentOps[0xcb], (instruction, oldPc) => {
    log("> rr m");
    time += 8;
    markHeat("rr");
    let oldC = (reg8[F] & FC) ? 1 : 0;
    
    let src = shiftGet(instruction);
    let c = src & 0b1;
    
    src >>>= 1;
    src |= oldC << 7;
    
    shiftSet(instruction, src, c);
});

fillMask(0x20, 0x7, parentOps[0xcb], (instruction, oldPc) => {
    log("> sla m");
    time += 8;
    markHeat("sla");
    
    let src = shiftGet(instruction);
    let c = src >>> 7;
    
    src <<= 1;
    
    shiftSet(instruction, src, c);
});

fillMask(0x28, 0x7, parentOps[0xcb], (instruction, oldPc) => {
    log("> sra m");
    time += 8;
    markHeat("sra");
    
    let src = shiftGet(instruction);
    let c = src & 0b1;
    
    src |= (src << 1) & 0x100;
    src >>>= 1;
    
    shiftSet(instruction, src, c);
});

fillMask(0x38, 0x7, parentOps[0xcb], (instruction, oldPc) => {
    log("> srl m");
    time += 8;
    markHeat("srl");
    
    let src = shiftGet(instruction);
    let c = src & 0b1;
    
    src >>>= 1;
    
    shiftSet(instruction, src, c);
});

parentOps[0xed][0x6f] = function(instruction, oldPc) {
    log("> rld");
    time += 18;
    markHeat("rld");
    
    let val = readMemory8(getRegPair(HL));
    val |= reg8[A] << 8;
    
    val <<= 4;
    val |= (val >>> 8) & 0xf;
    
    writeMemory8(getRegPair(HL), val & 0xff);
    reg8[A] &= ~0x0f;
    reg8[A] |= (val >>> 8) & 0xf;
    
    reg8[F] &= FC;
    if(isNegative(reg8[A], 1)) reg8[F] |= FS;
    if(!reg8[A]) reg8[F] |= FZ;
    if(parity(reg8[A], 1)) reg8[F] |= FS;
};

parentOps[0xed][0x6f] = function(instruction, oldPc) {
    log("> rrd");
    time += 18;
    markHeat("rrd");
    
    let val = readMemory8(getRegPair(HL));
    val |= reg8[A] << 8;
    
    val &= 0x0fff;
    val |= (val & 0xf) << 8;
    val >>>= 4;
    
    writeMemory8(getRegPair(HL), val & 0xff);
    reg8[A] &= ~0x0f;
    reg8[A] |= (val >>> 8) & 0xf;
    
    reg8[F] &= FC;
    if(isNegative(reg8[A], 1)) reg8[F] |= FS;
    if(!reg8[A]) reg8[F] |= FZ;
    if(parity(reg8[A], 1)) reg8[F] |= FS;
};


// ----
// Bit Set, Test and Reset
// ----
let bitGet = function(instruction) {
    let reg = instruction & 0b111;
    
    if(reg == 0b110) {
        // Memory
        time += 7;
        if(indirect != 0b111) time += 8;
        return readMemory8(getIndirect() + getIndirectDisplacement());
    }else{
        // Register
        return reg8[reg];
    }
};

let bitString = function(op, instruction) {
    let reg = instruction & 0b111;
    let bit = (instruction >>> 3) & 0b111;
    
    if(reg == 0b110) {
        // Memory
        log("> " + op + " " + bit + ",(" + indirectString() + " + 0x" + getIndirectDisplacement().toString(16) + ")");
    }else{
        // Register
        log("> " + op + " " + bit + "," + regString(reg));
    }
};

let bitSet = function(instruction, value) {
    let reg = instruction & 0b111;
    
    if(reg == 0b110) {
        // Memory
        writeMemory8(getIndirect() + getIndirectDisplacement(), value);
    }else{
        // Register
        reg8[reg] = value;
    }
};

fillMask(0x40, 0x3f, parentOps[0xcb], (instruction, oldPc) => {
    time += 8;
    markHeat("bit");
    
    let src = bitGet(instruction);
    let b = (instruction >>> 3) & 0b111;
    let mask = 1 << b;
    bitString("bit", instruction);
    
    reg8[F] &= FC;
    if(!(src & mask)) reg8[F] |= FZ;
    reg8[F] |= FH;
});

fillMask(0xc0, 0x3f, parentOps[0xcb], (instruction, oldPc) => {
    time += 8;
    markHeat("set");
    
    let src = bitGet(instruction);
    let b = (instruction >>> 3) & 0b111;
    let mask = 1 << b;
    bitString("set", instruction);
    
    src |= mask;
    
    bitSet(instruction, src);
});

fillMask(0x80, 0x3f, parentOps[0xcb], (instruction, oldPc) => {
    time += 8;
    markHeat("res");
    
    let src = bitGet(instruction);
    let b = (instruction >>> 3) & 0b111;
    let mask = 1 << b;
    bitString("res", instruction);
    
    src &= ~mask;
    
    bitSet(instruction, src & 0xff);
});


// ----
// Jump Group
// ----
let doCondition = function(instruction) {
    let con = (instruction >> 3) & 0b111;
    let flag;
    
    switch(con & 0b110) {
        case 0b000:
            flag = reg8[F] & FZ;
            break;
        
        case 0b010:
            flag = reg8[F] & FC;
            break;
        
        case 0b100:
            flag = reg8[F] & FPV;
            break;
        
        case 0b110:
            flag = reg8[F] & FS;
            break;
    }
    
    return (flag != 0) == ((con & 0b1) != 0);
}

let conditionString = function(instruction) {
    let con = (instruction >> 3) & 0b111;
    
    return ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"][con];
}

rootOps[0xc3] = function(instruction, oldPc) {
    time += 10;
    markHeat("jp");
    
    let n = pcAndAdvance(2);
    
    reg16[PC] = n;
    log("> jp #$" + n.toString(16));
};

fillMask(0xc2, 0x38, rootOps, (instruction, oldPc) => {
    time += 10;
    markHeat("jp");
    
    let n = pcAndAdvance(2);
    
    log("> jp " + conditionString(instruction) + ", #$" + n.toString(16));
    
    if(doCondition(instruction)) {
        log("Performing jump");
        reg16[PC] = n;
    }
});

rootOps[0x18] = function(instruction, oldPc) {
    time += 12;
    markHeat("jr");
    
    let displacement = pcAndAdvance(1);
    log("> jr #$" + makeSigned(displacement, 1).toString(16));
    
    reg16[PC] += makeSigned(displacement, 1);
};

fillMask(0x20, 0x18, rootOps, (instruction, oldPc) => {
    time += 10;
    markHeat("jr");
    
    let displacement = pcAndAdvance(1);
    log("> jr " + conditionString(instruction & 0x18) + ", #$" + makeSigned(displacement, 1).toString(16));
    
    if(doCondition(instruction & 0x18)) {
        log("Performing jump");
        reg16[PC] += makeSigned(displacement, 1);
    }
});

rootOps[0xe9] = function(instruction, oldPc) {
    log("> jp " + indirectString());
    time += 4;
    markHeat("jp");
    if(indirect != 0b111) time += 4;
    
    reg16[PC] = getIndirect();
};

rootOps[0x10] = function(instruction, oldPc) {
    log("> djnz");
    time += 8;
    markHeat("djnz");
    
    let displacement = pcAndAdvance(1);
    
    reg8[B] --;
    
    if(reg8[B] != 0) {
        time += 5;
        reg16[PC] += makeSigned(displacement, 1);
    }
};


// ----
// Call and Return Group
// ----
rootOps[0xcd] = function(instruction, oldPc) {
    time += 17;
    markHeat("call");
    addStack(reg16[PC]);
    
    let dest = pcAndAdvance(2);
    log("> call (#$" + dest.toString(16)+")");
    
    reg16[SP] -= 2;
    writeMemory16(reg16[SP], reg16[PC]);
    
    reg16[PC] = dest;
};

fillMask(0xc4, 0x38, rootOps, (instruction, oldPc) => {
    log("> call cc,nn");
    time += 10;
    markHeat("call");
    
    let dest = pcAndAdvance(2);
    
    if(doCondition(instruction)) {
        time += 7;
        addStack(reg16[PC]);
        
        reg16[SP] -= 2;
        writeMemory16(reg16[SP], reg16[PC]);
        
        reg16[PC] = dest;
    }
});

rootOps[0xc9] = function(instruction, oldPc) {
    log("> ret");
    time += 10;
    markHeat("ret");
    popStack();
    
    reg16[PC] = readMemory16(reg16[SP]);
    reg16[SP] += 2;
};

fillMask(0xc0, 0x38, rootOps, (instruction, oldPc) => {
    log("> ret cc");
    time += 5;
    markHeat("ret");
    popStack();
    
    if(doCondition(instruction)) {
        time += 6;
        
        reg16[PC] = readMemory16(reg16[SP]);
        reg16[SP] += 2;
    }
});

parentOps[0xed][0x4d] = function(instruction, oldPc) {
    log("> reti");
    time += 14;
    markHeat("reti");
    popStack();
    
    reg16[PC] = readMemory16(reg16[SP]);
    reg16[SP] += 2;
    
    //TODO: More interrupt stuff?
};

parentOps[0xed][0x45] = function(instruction, oldPc) {
    log("> retn");
    time += 14;
    markHeat("retn");
    popStack();
    
    reg16[PC] = readMemory16(reg16[SP]);
    reg16[SP] += 2;
    
    //TODO: More interrupt stuff?
    iff1 = iff2;
};

fillMask(0xc7, 0x38, rootOps, (instruction, oldPc) => {
    time += 11;
    markHeat("rst");
    
    let t = instruction & 0b00111000;
    log("> rst #$" + t.toString(16));
    
    reg16[SP] -= 2;
    writeMemory16(reg16[SP], reg16[PC]);
    
    reg16[PC] = t;
});


// ----
// Input and Output Group
// ----

rootOps[0xdb] = function(instruction, oldPc) {
    time += 11;
    markHeat("in");
    
    let port = pcAndAdvance(1);
    log("> in A,(0x" + port.toString(16) + ")");
    let val = portIn(port);
    
    reg8[A] = val;
};

fillMask(0x40, 0x30, parentOps[0xed], (instruction, oldPc) => {
    time += 12;
    markHeat("in");
    let reg = (instruction >>> 3) & 0b111;
    
    let port = reg8[C];
    log("> in " + regString(reg) + ",(0x" + port.toString(16) + ")");
    let val = portIn(port);
    
    reg8[reg] = val;
    
    reg8[F] &= ~FC;
    if(isNegative(val, 1)) reg8[F] |= FS;
    if(!val) reg8[F] |= FZ;
    if(parity(val)) reg8[F] |= FPV;
});

parentOps[0xed][0xa2] = function(instruction, oldPc) {
    log("> ini");
    time += 16;
    markHeat("ini");
    
    let port = reg8[C];
    let val = portIn(port);
    
    reg8[B] --;
    writeMemory8(getRegPair(HL), val);
    setRegPair(HL, getRegPair(HL) + 1);
    
    reg8[F] &= ~(FC | FN | FZ);
    reg8[F] |= FN;
    if(!reg8[B]) reg8[F] |= FZ;
};

parentOps[0xed][0xb2] = function(instruction, oldPc) {
    log("> inir");
    markHeat("inir");
    
    parentOps[0xed][0xa2](instruction, oldPc); // Call the ini instruction
    
    // Check its flags
    if(!(reg8[F] & FZ)) {
        time += 5;
        reg16[PC] -= 2;
    }
};

parentOps[0xed][0xaa] = function(instruction, oldPc) {
    log("> ind");
    time += 16;
    markHeat("ind");
    
    let port = reg8[C];
    let val = portIn(port);
    
    reg8[B] --;
    writeMemory8(getRegPair(HL), val);
    setRegPair(HL, getRegPair(HL) - 1);
    
    reg8[F] &= ~(FC | FN | FZ);
    reg8[F] |= FN;
    if(!reg8[B]) reg8[F] |= FZ;
};

parentOps[0xed][0xba] = function(instruction, oldPc) {
    log("> indr");
    markHeat("indr");
    
    parentOps[0xed][0xaa](instruction, oldPc); // Call the ini instruction
    
    // Check its flags
    if(!(reg8[F] & FZ)) {
        time += 5;
        reg16[PC] -= 2;
    }
};

rootOps[0xd3] = function(instruction, oldPc) {
    time += 11;
    markHeat("out");
    
    let port = pcAndAdvance(1);
    log("> out (0x" + port.toString(16) + "),A");
    portOut(port, reg8[A]);
};

fillMask(0x41, 0x38, parentOps[0xed], (instruction, oldPc) => {
    log("> out (c),r");
    time += 12;
    markHeat("out");
    let reg = (instruction >>> 3) & 0b111;
    
    let port = reg8[C];
    portOut(port, reg8[A]);
});

parentOps[0xed][0xa3] = function(instruction, oldPc) {
    log("> outi");
    time += 16;
    markHeat("outi");
    
    let port = reg8[C];
    portOut(port, readMemory8(getRegPair(HL)));
    
    reg8[B] --;
    setRegPair(HL, getRegPair(HL) + 1);
    
    reg8[F] &= ~(FC | FZ | FN);
    reg8[F] |= FN;
    if(!reg8[B]) reg8[F] |= FZ;
};

parentOps[0xed][0xb3] = function(instruction, oldPc) {
    log("> outir");
    markHeat("outir");
    
    parentOps[0xed][0xa3](instruction, oldPc); // Call the outi instruction
    
    // Check its flags
    if(!(reg8[F] & FZ)) {
        time += 5;
        reg16[PC] -= 2;
    }
};

parentOps[0xed][0xab] = function(instruction, oldPc) {
    log("> outd");
    time += 16;
    markHeat("outd");
    
    let port = reg8[C];
    portOut(port, readMemory8(getRegPair(HL)));
    
    reg8[B] --;
    setRegPair(HL, getRegPair(HL) - 1);
    
    reg8[F] &= ~(FC | FZ | FN);
    reg8[F] |= FN;
    if(!reg8[B]) reg8[F] |= FZ;
};

parentOps[0xed][0xbb] = function(instruction, oldPc) {
    log("> outdr");
    markHeat("outdr");
    
    parentOps[0xed][0xab](instruction, oldPc); // Call the outd instruction
    
    // Check its flags
    if(!(reg8[F] & FZ)) {
        time += 5;
        reg16[PC] -= 2;
    }
};
