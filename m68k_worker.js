"use strict";

const MSG_START = 0;
const MSG_STOP = 1;
const MSG_INIT = 2;
const MSG_RESET = 3;
const MSG_FRAME = 4;
const MSG_NEWROM = 5;
const MSG_DOIO = 6;

const SHM_IO = 0;
const SHM_DATA = 1;
const SHM_ADDR = 2;
const SHM_LENGTH = 3; // Length of the memory read/write
const SHM_INT = 4; // Interrupt

const MEM_NONE = 0; // Memory bus: SHM_IO is set by the worker depending on the operation, which is then cleared by the
const MEM_READ = 1; //  main m68k class
const MEM_WRITE = 2;

const MODE_MD = "md"; // Mega drive
const MODE_MS = "ms"; // Master system

const CLOCK_NTSC = 7670453;
const CLOCK_PAL = 7600489;
const FPS = 60;

console.log("M68k Worker Started!");

const SP = 15;
const PC = 16;
const CCR = 17;
const SR = 18;
const DBASE = 0;
const ABASE = 8;

const USER = 0;
const SUPER = 1;
const EXCEPT = 2;

const EX_ILLEGAL = 0x04;
const EX_DIV0 = 0x05;
const EX_CHK = 0x06;
const EX_TRAPV = 0x07;
const EX_PRIV_VIO = 0x08;

const C = 0x0001; // Carry
const V = 0x0002; // Overflow
const Z = 0x0004; // Zero
const N = 0x0008; // Negative
const X = 0x0010; // Extend

const I0 = 0x0100; // Interrupt priority mask 1
const I1 = 0x0200; // Interrupt priority mask 2
const I2 = 0x0400; // Interrupt priority mask 3
const S = 0x2000; // Supervisor
const T = 0x8000; // Trace //TODO: Implement this

let masks = {};
const MOVE_TO_CCR = Symbol("MOVE_TO_CCR");
masks[MOVE_TO_CCR] = [0xffc0, 0x44c0];
const MOVE_FROM_SR = Symbol("MOVE_FROM_SR");
masks[MOVE_FROM_SR] = [0xffc0, 0x40c0];
const MOVE_TO_SR = Symbol("MOVE_TO_SR");
masks[MOVE_TO_SR] = [0xffc0, 0x46c0];
const ANDI_TO_CCR = Symbol("ANDI_TO_CCR");
masks[ANDI_TO_CCR] = [0xffff, 0x023c];
const ORI_TO_CCR = Symbol("ORI_TO_CCR");
masks[ORI_TO_CCR] = [0xffff, 0x003c];
const EORI_TO_CCR = Symbol("EORI_TO_CCR");
masks[EORI_TO_CCR] = [0xffff, 0x0a3c];
const ANDI_TO_SR = Symbol("ANDI_TO_SR");
masks[ANDI_TO_SR] = [0xffff, 0x027c];
const EORI_TO_SR = Symbol("EORI_TO_SR");
masks[EORI_TO_SR] = [0xffff, 0x0a7c];
const ORI_TO_SR = Symbol("ORI_TO_SR");
masks[ORI_TO_SR] = [0xffff, 0x007c];
const ABCD = Symbol("ABCD");
masks[ABCD] = [0xf1f0, 0xc100];
const ADD_ADDA = Symbol("ADD_ADDA");
masks[ADD_ADDA] = [0xf000, 0xd000, (x) => (!(x & 0x0100) || (x & 0x00c0) == 0x00c0 || ![0x0008, 0x0000].includes(x & 0x0038))];
const ADDI = Symbol("ADDI");
masks[ADDI] = [0xff00, 0x0600, (x) => ((x >> 6) & 0b11) != 0b11 && (x & 0x0038) != 0x0008];
const ADDQ = Symbol("ADDQ");
masks[ADDQ] = [0xf100, 0x5000, (x) => (x & 0x00c0) != 0x00c0];
const ADDX = Symbol("ADDX");
masks[ADDX] = [0xf130, 0xd100, (x) => (x & 0x00c0) != 0x00c0];
const AND = Symbol("AND");
masks[AND] = [0xf000, 0xc000, (x) => (x & 0x00c0) != 0x00c0 && (x & 0x0038) != 0x0008 && (!(x & 0x0100)||(x & 0x0038))];
const EOR = Symbol("EOR");
masks[EOR] = [0xf100, 0xb100, (x) => (x & 0x00c0) != 0x00c0 && (x & 0x0038) != 0x0008];
const OR = Symbol("OR");
masks[OR] = [0xf000, 0x8000, (x) => (x & 0x00c0) != 0x00c0 && (x & 0x0038) != 0x0008 && (!(x & 0x0100)||(x & 0x0038))];
const ANDI = Symbol("ANDI");
masks[ANDI] = [0xff00, 0x0200, (x) => ((x >> 6) & 0b11) != 0b11 && (x & 0x0038) != 0x0008 && (x & 0x003f) != 0x003c];
const EORI = Symbol("EORI");
masks[EORI] = [0xff00, 0x0a00, (x) => ((x >> 6) & 0b11) != 0b11 && (x & 0x0038) != 0x0008 && (x & 0x003f) != 0x003c];
const ORI = Symbol("ORI");
masks[ORI] = [0xff00, 0x0000, (x) => ((x >> 6) & 0b11) != 0b11 && (x & 0x0038) != 0x0008 && (x & 0x003f) != 0x003c];
const SHIFT_REG = Symbol("SHIFT_REG");
masks[SHIFT_REG] = [0xf010, 0xe000, (x) => (x & 0x00c0) != 0x00c0];
const SHIFT_MEM = Symbol("SHIFT_MEM");
masks[SHIFT_MEM] = [0xfec0, 0xe0c0];
const BMOD_REG = Symbol("BMOD_REG"); // btst/bchg/bclr/bset
masks[BMOD_REG] = [0xf100, 0x0100, (x) => (x & 0x0038) != 0x0008];
const BMOD_IMM = Symbol("BMOD_IMM"); // btst/bchg/bclr/bset
masks[BMOD_IMM] = [0xff00, 0x0800, (x) => (x & 0x0038) != 0x0008];
const DBCC = Symbol("DBCC");
masks[DBCC] = [0xf0f8, 0x50c8];
const CHK = Symbol("CHK");
masks[CHK] = [0xf1c0, 0x4180];
const CLR = Symbol("CLR");
masks[CLR] = [0xff00, 0x4200, (x) => (x & 0x00c0) != 0x00c0];
const CMP_CMPA = Symbol("CMP_CMPA");
masks[CMP_CMPA] = [0xf000, 0xb000, (x) => ![0b100, 0b101, 0b110].includes((x >> 6) & 0b111)];
const CMPM = Symbol("CMPM");
masks[CMPM] = [0xf138, 0xb108, (x) => ((x >> 6) & 0b11) != 0b11];
const CMPI = Symbol("CMPI");
masks[CMPI] = [0xff00, 0x0c00, (x) => ((x >> 6) & 0b11) != 0b11 && (x & 0x0038) != 0x0008];
const DIVS = Symbol("DIVS");
masks[DIVS] = [0xf1c0, 0x81c0];
const DIVU = Symbol("DIVU");
masks[DIVU] = [0xf1c0, 0x80c0];
const EXG = Symbol("EXG");
masks[EXG] = [0xf130, 0xc100, (x) => [0b01000, 0b01001, 0b10001].includes((x >> 3) & 0b11111)];
const EXT = Symbol("EXT");
masks[EXT] = [0xffb8, 0x4880];
const ILLEGAL = Symbol("ILLEGAL");
masks[ILLEGAL] = [0xffff, 0x4afc];
const JMP = Symbol("JMP");
masks[JMP] = [0xffc0, 0x4ec0];
const JSR = Symbol("JSR");
masks[JSR] = [0xffc0, 0x4e80];
const LEA = Symbol("LEA");
masks[LEA] = [0xf1c0, 0x41c0];
const LINK = Symbol("LINK");
masks[LINK] = [0xffff8, 0x4e50];
const MOVEQ = Symbol("MOVEQ");
masks[MOVEQ] = [0xf100, 0x7000];
const MOVEP = Symbol("MOVEP");
masks[MOVEP] = [0xf038, 0x0008];
const MULS = Symbol("MULS");
masks[MULS] = [0xf1c0, 0xc1c0];
const MULU = Symbol("MULU");
masks[MULU] = [0xf1c0, 0xc0c0];
const MOVE_USP = Symbol("MOVE_USP");
masks[MOVE_USP] = [0xfff0, 0x4e60];
const NBCD = Symbol("NBCD");
masks[NBCD] = [0xff90, 0xf800];
const NEG = Symbol("NEG");
masks[NEG] = [0xff00, 0x4400, (x) => ((x >> 6) & 0b11) != 0b11 && (x & 0x0038) != 0x0008];
const NEGX = Symbol("NEGX");
masks[NEGX] = [0xff00, 0x4000, (x) => ((x >> 6) & 0b11) != 0b11 && (x & 0x0038) != 0x0008];
const PEA = Symbol("PEA");
masks[PEA] = [0xffc0, 0x4840, (x) => [0x0010, 0x0028, 0x001c].includes(x & 0x0038)];
const SUB_SUBA = Symbol("SUB_SUBA");
masks[SUB_SUBA] = [0xf000, 0x9000, (x) => (!(x & 0x0100)||![0x0008, 0x0000].includes(x & 0x0038))];
const SUBX = Symbol("SUBX");
masks[SUBX] = [0xf130, 0x9100];
const SUBI = Symbol("SUBI");
masks[SUBI] = [0xff00, 0x0400, (x) => ((x >> 6) & 0b11) != 0b11 && (x & 0x0038) != 0x0008];
const SUBQ = Symbol("SUBQ");
masks[SUBQ] = [0xf100, 0x5100, (x) => (x & 0x00c0) != 0x00c0];
const NOP = Symbol("NOP");
masks[NOP] = [0xffff, 0x4e71];
const NOT = Symbol("NOT");
masks[NOT] = [0xff00, 0x4600, (x) => (x & 0x00c0) != 0x00c0];
const BCC_BRA_BSR = Symbol("BCC_BRA_BSR");
masks[BCC_BRA_BSR] = [0xf000, 0x6000];
const MOVE_MOVEA = Symbol("MOVE_MOVEA");
masks[MOVE_MOVEA] = [0xc000, 0x0000, (x) => x & 0x3000];
const MOVEM_TO_REG = Symbol("MOVEM_TO_REG");
masks[MOVEM_TO_REG] = [0xff80, 0x4c80, (x) => [0x0010, 0x0018, 0x0028, 0x0030, 0x0038].includes(x & 0x0038)];
const MOVEM_TO_MEM = Symbol("MOVEM_TO_MEM");
masks[MOVEM_TO_MEM] = [0xff80, 0x4880, (x) => [0x0010, 0x0020, 0x0028, 0x0030, 0x0038].includes(x & 0x0038)];
const RESET = Symbol("RESET");
masks[RESET] = [0xffff, 0x4e70];
const ROL_ROR_REG = Symbol("ROL_ROR_REG");
masks[ROL_ROR_REG] = [0xf018, 0xe018, (x) => (x & 0x00c0) != 0x00c0];
const ROL_ROR_MEM = Symbol("ROL_ROR_MEM");
masks[ROL_ROR_MEM] = [0xfec0, 0xe6c0];
const ROXL_ROXR_REG = Symbol("ROXL_ROXR_REG");
masks[ROXL_ROXR_REG] = [0xf018, 0xe010, (x) => (x & 0x00c0) != 0x00c0];
const ROXL_ROXR_MEM = Symbol("ROXL_ROXR_MEM");
masks[ROXL_ROXR_MEM] = [0xfec0, 0xe4c0];
const RTE = Symbol("RTE");
masks[RTE] = [0xffff, 0x4e73];
const RTR = Symbol("RTR");
masks[RTR] = [0xffff, 0x4e77];
const RTS = Symbol("RTS");
masks[RTS] = [0xffff, 0x4e75];
const SBCD = Symbol("SBCD");
masks[SBCD] = [0xf1f0, 0x8100];
const SCC = Symbol("SCC");
masks[SCC] = [0xf0c0, 0x50c0, (x) => (x & 0x0038) != 0x0008];
const STOP = Symbol("STOP");
masks[STOP] = [0xffff, 0x4e72];
const SWAP = Symbol("SWAP");
masks[SWAP] = [0xfff8, 0x4840];
const TAS = Symbol("TAS");
masks[TAS] = [0xffc0, 0x4ac0, (x) => (x & 0x0038) != 0x0008 && x != 0x4afc];
const TRAP = Symbol("TRAP");
masks[TRAP] = [0xfff0, 0x4e40];
const TRAPV = Symbol("TRAPV");
masks[TRAPV] = [0xffff, 0x4e76];
const TST = Symbol("TST");
masks[TST] = [0xff00, 0x4a00, (x) => (x & 0x00c0) != 0x00c0];
const UNLK = Symbol("UNLK");
masks[UNLK] = [0xfff8, 0x4e58];
let opcodes = Object.getOwnPropertySymbols(masks);

let instructionMappings = new Uint8Array(0x10000); // Instruction to index in opcodes array
for(let i = 0; i <= 0xffff; i ++) {
    let set = false;
    
    for(let op of opcodes) {
        if((i & masks[op][0]) == masks[op][1] && (masks[op][2] ? masks[op][2](i) : true)) {
            instructionMappings[i] = opcodes.indexOf(op);
            set = true;
            break;
        }
    }
    
    if(!set) instructionMappings[i] = opcodes.indexOf(ILLEGAL);
}


let u8 = new Uint8Array(1);
let u16 = new Uint16Array(1);
let u32 = new Uint32Array(1);

const DEBUG = false;
const LOGGING = true;
const TRACE_STATE = true;

let doCondition = function(condition, value) {
    switch(condition) {
        case 0b0000:
            // T
            return true;
        case 0b0001:
            // F
            return false;
        case 0b0010:
            // HI (¬C && ¬Z)
            return (value & (C | Z)) == 0;
        case 0b0011:
            // LS (C || Z)
            return (value & (C | Z)) != 0;
        case 0b0100:
            // Carry Clear (¬C)
            return (value & C) == 0;
        case 0b0101:
            // Carry Set (C)
            return (value & C) != 0;
        case 0b0110:
            // NE (¬Z)
            return (value & Z) == 0;
        case 0b0111:
            // EQ (Z)
            return (value & Z) != 0;
        case 0b1000:
            // VC (¬V)
            return (value & V) == 0;
        case 0b1001:
            // VS (V)
            return (value & V) != 0;
        case 0b1010:
            // PL (¬N)
            return (value & N) == 0;
        case 0b1011:
            // MI (N)
            return (value & N) != 0;
        case 0b1100:
            // GE (N && V || ¬N && ¬V)
            return ((value & N) && (value & V)) || ((value & (N | V)) == 0);
        case 0b1101:
            // LT (N && ¬V || ¬N && V)
            return ((value & N) && (value & V) == 0) || ((value & N) == 0 && (value & V));
        case 0b1110:
            // GT (N && V && ¬Z || ¬N && ¬V && ¬Z)
            return (((value & N) && (value & V)) || ((value & (N | V)) == 0)) && (value & Z) == 0;
        case 0b1111:
            // LE (Z || (N && ¬V || ¬N && V)
            return (value & Z) || ((value & N) && !(value & V)) || (!(value & N) && (value & V));
        default:
            console.error("Invalid condition!");
            return;
    }
}

let getOperandLength = function(instruction, allowAddress) {
    let opmode = (instruction >> 6) & 0b111;
    
    if(!allowAddress && (opmode & 0b011) == 0b011) {
        console.error("Invalid operand length value in 0x" + instruction.toString(16));
    }
    
    switch(opmode) {
        case 0b000:
        case 0b100:
            return [1, u8];
        
        case 0b001:
        case 0b101:
        case 0b011:
            return [2, u16];
        
        case 0b010:
        case 0b110:
        case 0b111:
            return [4, u32];
    }
}

let lengthString = function(l) {
    if(!LOGGING) return "";
    
    switch(l) {
        case 1: return ".b";
        case 2: return ".w";
        case 4: return ".l";
        default: return ".?";
    }
}

let regString = function(r) {
    if(r == PC) return "pc";
    if(r == CCR) return "ccr";
    if(r == SP) return "sp";
    if(r > ABASE) return "a" + (r - ABASE);
    return "d" + r;
}

let conditionStr = function(condition) {
    if(!LOGGING) return "";
    
    switch(condition) {
        case 0b0000: return "t";
        case 0b0001: return "f";
        case 0b0010: return "hi";
        case 0b0011: return "ls";
        case 0b0100: return "cc";
        case 0b0101: return "cs";
        case 0b0110: return "ne";
        case 0b0111: return "eq";
        case 0b1000: return "vc";
        case 0b1001: return "vs";
        case 0b1010: return "pl";
        case 0b1011: return "mi";
        case 0b1100: return "ge";
        case 0b1101: return "lt";
        case 0b1110: return "gt";
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

let addCcr = function(a, b, result, length) {
    let ccr = 0;
    ccr |= result == 0 ? Z : 0;
    ccr |= isNegative(result, length) ? N : 0;
    
    // Carry
    if(result < a) {
        ccr |= C | X;
    }
    
    // Overflow
    let highBitMask = 1 << ((length * 8) - 1)
    if((a & b & highBitMask) || (~a & ~b & highBitMask)) {
        if((a & highBitMask) != (result & highBitMask)) {
            ccr |= V;
        }
    }
    return ccr;
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

let checkOpcodes = function() {
    // Checks opcodes to make sure they work right
    
    // Check that there are no cases where two opcodes are identefied for the same byte
    for(let i = 0; i <= 0xffff; i ++) {
        let set = null;
        for(let op of Object.getOwnPropertySymbols(masks)) {
            if((i & masks[op][0]) == masks[op][1] && (masks[op][2] ? masks[op][2](i) : true)) {
                if(!set) {
                    set = op;
                }else{
                    console.error("Instruction 0x"+i.toString(16)+" decodes to %o and %o", set, op);
                }
            }
        }
    }
    
    // And that the masks are set right
    for(let op of Object.getOwnPropertySymbols(masks)) {
        if((masks[op][1] & masks[op][0]) != masks[op][1]) {
            console.error("Mask of %o not set right.", op);
        }
        
        if(masks[op][1] == masks[op][0]) {
            console.error("%o is all ones!?", op);
        }
    }
}

checkOpcodes();

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
            break;
        
        case MSG_STOP:
            stopped = true;
            break;
        
        case MSG_START:
            reset();
            stopped = false;
            break;
        
        case MSG_FRAME:
            doFrame(data[0]);
            break;
        
        default:
            console.error("M68k worker got unknown message type "+e.data[0]);
            break;
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

let clock = function() {
    if(options.region == "pal") {
        return CLOCK_PAL;
    }else{
        return CLOCK_NTSC;
    }
};

// Init
let registers = new Uint32Array(19);
registers[SR] = S;

let time = 0;
let worldTime = 0;
let mode = SUPER;
let oldSp = 0;
let logEntries = new Array(500);
let logp = 0;
let crashed = false;
let stopped = false;
let heat = new Uint32Array(opcodes.length);
let state;
if(TRACE_STATE) state = new Uint32Array(19);

let shared = null;
let options = null;
let ram = null;
let rom = null;

let log = function(msg) {
    if(DEBUG) {
        console.log("[m68k] " + msg);
    }
    
    if(!LOGGING) return;
    logp += 1;
    logp %= 500;
    logEntries[logp] = msg;
}

let dumpLog = function() {
    if(!LOGGING) {
        console.log("Logging disabled...");
    }else{
        for(let i = logp; (i != logp +1) && !(logp == 500 && i == 0); (i != 0) ? i -- : i = 500) {
            console.log(logEntries[i]);
        }
    }
}

// Memory read
let readMemory = function(i, n) {
    i &= 0xffffff;
    
    if(i < 0x400000) {
        // ROM
        switch(n) {
            case 1:
                return rom.getUint8(i);
            
            case 2:
                return rom.getUint16(i, false);
            
            case 4:
                return rom.getUint32(i, false);
            
            default:
                console.error("Unknown length given to readMemory!");
                return 0;
        }
    }
    
    if(i >= 0xff0000) {
        // RAM
        i &= 0x00ffff;
        switch(n) {
            case 1:
                return ram.getUint8(i);
            
            case 2:
                return ram.getUint16(i, false);
            
            case 4:
                return ram.getUint32(i, false);
            
            default:
                console.error("Unknown length given to readMemory!");
                return 0;
        }
    }
    
    Atomics.store(shared, SHM_ADDR, i);
    Atomics.store(shared, SHM_LENGTH, n);
    Atomics.store(shared, SHM_IO, MEM_READ);
    self.postMessage([MSG_DOIO, null]);
    Atomics.wait(shared, SHM_IO, MEM_READ);
    return shared[SHM_DATA];
};
let readMemory8 = (i) => readMemory(i, 1);
let readMemory16 = (i) => readMemory(i, 2);
let readMemory32 = (i) => readMemory(i, 4);

// And write
let writeMemory = function(i, val, n) {
    i &= 0xffffff;
    
    if(i >= 0xff0000) {
        // RAM
        i &= 0x00ffff;
        switch(n) {
            case 1:
                return void ram.setUint8(i, val);
            
            case 2:
                return void ram.setUint16(i, val, false);
            
            case 4:
                return void ram.setUint32(i, val, false);
            
            default:
                console.error("Unknown length given to writeMemory!");
                return 0;
        }
    }
    
    Atomics.store(shared, SHM_DATA, val);
    Atomics.store(shared, SHM_ADDR, i);
    Atomics.store(shared, SHM_LENGTH, n);
    Atomics.store(shared, SHM_IO, MEM_WRITE);
    self.postMessage([MSG_DOIO, null]);
    Atomics.wait(shared, SHM_IO, MEM_WRITE);
};
let writeMemory8 = (i, val) => writeMemory(i, val, 1);
let writeMemory16 = (i, val) => writeMemory(i, val, 2);
let writeMemory32 = (i, val) => writeMemory(i, val, 4);

// Read N bytes the PC and increment it by length. If length = 2, the lower byte of the word is read
let pcAndAdvance = function(length) {
    if(length === undefined) console.error("pcAndAdvance: Length is undefined");
    
    if(length == 4) {
        time += 8;
    }else{
        time += 4;
    }
    
    if(length == 1) {
        let next = readMemory16(registers[PC]) & 0x00ff;
        registers[PC] += 2;
        return next;
    }else{
        let next = readMemory(registers[PC], length);
        registers[PC] += length;
        return next;
    }
}

// Calculates and returns the ccr for a subtract operation (a - b)
// When using negx or subx, set withExtend to true
let subCcr = function(a, b, result, length, touchX, withExtend) {
    let originalX = registers[CCR] & X;
    
    let ccr = registers[CCR] & (touchX ? 0 : X);
    if(withExtend) {
        ccr |= result == 0 ? Z : (registers[CCR] & Z);
    }else{
        ccr |= result == 0 ? Z : 0;
    }
    ccr |= isNegative(result, length) ? N : 0;
    
    // Borrow
    if(result > a) {
        ccr |= C | (touchX ? X : 0);
    }
    
    if(result == 0 && withExtend && originalX) {
        // Extend bit would cause borrow
        ccr |= C | (touchX ? X : 0);
    }
    
    //Overflow
    let as = makeSigned(a, length);
    let bs = makeSigned(b, length);
    let rs = makeSigned(result, length);
    
    if((rs < as) != (bs > 0)) {
        ccr |= V;
    }
    
    if(rs == (1 << (length * 8 - 1)) && withExtend && originalX) {
        // If the extend bit would cause an overflow
        ccr |= V;
    }
    
    return ccr;
}

let getExtensionWord = function() {
    let word = pcAndAdvance(2);
    
    let reg = (word >> 12) & 0b1111;
    let long = (word & (1 << 11)) != 0;
    let scale = 1 << ((word >> 9) & 0b11);
    let displacement = makeSigned(word & 0xff, 1);
    
    if(word & 0x0100) {
        console.error("Complicated extension word, help!");
        return [0, false, 1, 0];
    }
    
    return [reg, long, scale, displacement];
}

// Calculates the effective address that a given specifier points to and returns it
let addressEa = function(ea, length) {
    if(length === undefined) console.error("AddressEa called without a length param!");
    
    switch(ea & 0b111000) {
        case 0b010000: { // Address Register Indirect
            time += 4;
            return registers[ABASE + (ea & 0b000111)];
        }
        
        case 0b011000: { // Address Register Indirect with Postincrement Mode
            if((ea & 0b000111) == SP - ABASE && length == 1) {
                length = 2; // Need to keep the stack aligned
            }
            time += 4;
            let toReturn = registers[ABASE + (ea & 0b000111)];
            registers[ABASE + (ea & 0b000111)] += length;
            return toReturn;
        }
        
        case 0b100000: { // Address Register Indirect with Predecrement Mode
            if((ea & 0b000111) == SP - ABASE && length == 1) {
                length = 2; // Need to keep the stack aligned
            }
            time += 6;
            registers[ABASE + (ea & 0b000111)] -= length;
            return registers[ABASE + (ea & 0b000111)];
        }
        
        case 0b101000: { // Address Register Indirect with Displacement Mode
            time += 8;
            let next = pcAndAdvance(2);
            next = makeSigned(next, 2);
            next += registers[ABASE + (ea & 0b000111)];
            return next;
        }
        
        case 0b110000: { // Address Register Indirect with Index (8-Bit Displacement) Mode
            let [reg, long, scale, displacement] = getExtensionWord();
            time += 2;
            
            let addr = registers[ABASE + (ea & 0b000111)];
            addr += displacement;
            if(long) {
                addr += makeSigned(registers[reg], 4) * scale;
            }else{
                addr += makeSigned(registers[reg] & 0xffff, 2) * scale;
            }
            return addr;
        }
        
        case 0b111000: {
            let next = 0;
            
            if(ea == 0b111000) { // Absolute short
                time += 8;
                next = pcAndAdvance(2);
                if(isNegative(next, 2)) {
                    next |= 0xffff0000;
                    next >>>= 0;
                }
            }else if(ea == 0b111001) { // Absolute long
                time += 12;
                next = pcAndAdvance(2) << 16;
                next |= pcAndAdvance(2);
            }else if(ea == 0b111010) { // PC indirect with displacement mode
                time += 8;
                next = pcAndAdvance(2);
                next = makeSigned(next, 2);
                next += registers[PC] - 2;
            }else if(ea == 0b111011) { // Program Counter Indirect with Index (8-Bit Displacement) Mode
                let addr = registers[PC];
                let [reg, long, scale, displacement] = getExtensionWord();
                time += 2;
                
                addr += displacement;
                if(long) {
                    addr += makeSigned(registers[reg], 4) * scale;
                }else{
                    addr += makeSigned(registers[reg] & 0xffff, 2) * scale;
                }
                return addr;
            }else{
                console.error("Unknown Effective Address mode: 0b" + ea.toString(2));
                return 0x0;
            }
            
            return next;
        }
        
        default:
            console.error("Unknown Effective Address mode: 0b" + ea.toString(2));
            return 0x0;
    }
}

// Reads the value of an effective address, reads the value of `addressEa`, and also supports register reads
let readEa = function(ea, length) {
    if(length === undefined) console.error("Length is undefined");
    switch(ea & 0b111000) {
        case 0b000000: { // Data Register Direct Mode
            return registers[DBASE + ea] & lengthMask(length);
        }
        
        case 0b001000: { // Address Register Direct Mode
            return registers[ABASE + (ea & 0b000111)] & lengthMask(length);
        }
        
        case 0b111000: {
            if(ea == 0b111100) { // Immediate
                return pcAndAdvance(length);
            }else{ // Try if it's an address specifier
                if(length == 4) time += 4;
                return readMemory(addressEa(ea, length), length);
            }
        }
        
        default:
            // Try if it's an address specifier
            if(length == 4) time += 4;
            return readMemory(addressEa(ea, length), length);
    }
}

let writeEa = function(ea, value, length) {
    if(length === undefined) console.error("Length is undefined");
    switch(ea & 0b111000) {
        case 0b000000: { // Data Register Direct Mode
            registers[ea] &= ~lengthMask(length);
            registers[ea] |= value & lengthMask(length);
            return;
        }
        
        case 0b001000: { // Address Register Direct Mode
            registers[ea] = value < 0 ? value : makeSigned(value, length);
            return;
        }
        
        default: { // Try if it's an address specifier
            if(length == 4) time += 4;
            writeMemory(addressEa(ea, length), value, length);
            return;
        }
    }
}

let eaStr = function(ea, length, pc) {
    if(!LOGGING) return "";
    
    switch(ea & 0b111000) {
        case 0b000000: { // Data register
            return "d" + ea;
        }
        
        case 0b001000: { // Address register
            return "a" + (ea & 0b000111);
        }
        
        case 0b010000: { // Address Register Indirect
            return "(a"+(ea & 0b000111)+")";
        }
        
        case 0b011000: { // Address Register Indirect with Postincrement Mode
            return "(a"+(ea & 0b000111)+")+";
        }
        
        case 0b100000: { // Address Register Indirect with Predecrement Mode
            return "-(a"+(ea & 0b000111)+")";
        }
        
        case 0b101000: { // Address Register Indirect with Displacement Mode
            return "($"+readMemory16(pc + 2).toString(16)+", a"+(ea & 0b000111)+")";
        }
        
        case 0b110000: { // Address Register Indirect with Index (8-Bit Displacement) Mode
            return "(a"+(ea & 0b000111)+
                " indirect with index ext 0x"+readMemory16(pc + 2).toString(16)+")";
        }
        
        case 0b111000: {
            let next = 0;
            
            if(ea == 0b111000) { // Absolute short
                let next = readMemory16(pc + 2);
                if(isNegative(next, 2)) {
                    next |= 0xffff0000;
                    next >>>= 0;
                }
                return "(#$"+next.toString(16)+").w";
            }else if(ea == 0b111001) { // Absolute long
                return "(#$"+readMemory32(pc + 2).toString(16)+").l";
            }else if(ea == 0b111010) { // PC indirect with displacement mode
                return "($"+readMemory16(pc + 2).toString(16)+", pc)";
            }else if(ea == 0b111011) { // Program Counter Indirect with Index (8-Bit Displacement) Mode
                return "(pc indirect with index ext 0x"+readMemory16(pc + 2).toString(16)+")";
            }else if(ea == 0b111100) { // Immediate Data
                return "$#"+readMemory(pc + 2, length).toString(16)
            }else{
                console.error("Unknown Effective Address mode: 0b" + ea.toString(2));
            }
            
            return next;
        }
        
        default:
            return "??";
    }
}

let getImmediate = function(instruction) {
    let immediate;
    switch(instruction & 0x00c0) {
        case 0x0000:
            immediate = pcAndAdvance(1);
            return [1, immediate, u8];
        case 0x0040:
            immediate = pcAndAdvance(2);
            return [2, immediate, u16];
        case 0x0080:
            immediate = pcAndAdvance(4);
            return [4, immediate, u32];
        default:
            console.error("GetImmediate failed to find an immediate value!");
            return [2, 0, u16];
    }
}

// Get the properties of a shift/rotate operation
let getShift = function(instruction) {
    let cr = (instruction >> 9) & 0b111;
    let left = (instruction & 0x0100) != 0;
    let size = (instruction >> 6) & 0b11;
    let register = (instruction & 0x0020) != 0;
    let regNo = instruction & 0b111;
    
    if(register) {
        cr = registers[cr] % 64;
    }else{
        if(cr == 0) cr = 8;
    }
    
    let length = 1;
    if(size == 0b01) {
        length = 2;
    }else if(size == 0b10) {
        length = 4;
    }
    
    return [cr, left, length, regNo];
}

let reset = function() {
    changeMode(SUPER);
    registers[SP] = readMemory32(0x0000);
    registers[PC] = readMemory32(0x0004);
    crashed = false;
};

let changeMode = function(mode) {
    let oldMode = mode;
    mode = mode;
    log("Mode change " + oldMode + " -> " + mode);
    
    if((mode == USER && oldMode == SUPER) || (mode == SUPER && oldMode == USER)) {
        let tmp = oldSp;
        oldSp = registers[SP];
        registers[SP] = tmp;
    }
}

let trap = function(vector) {
    log("Got exception 0x" + vector.toString(16));
    let tmp = registers[SR] | registers[CCR];
    registers[SR] &= 0x0fff;
    registers[SR] |= S;
    changeMode(SUPER);
    stopped = false;
    
    let handler = readMemory32(vector * 4);
    registers[SP] -= 4;
    writeMemory32(registers[SP], registers[PC]);
    registers[SP] -= 2;
    writeMemory32(registers[SP], tmp);
    registers[PC] = handler;
}

let getInstruction = function(word) {
    return opcodes[instructionMappings[word]];
}

let doInstruction = function() {
    // Are we crashed?
    if(crashed) {
        time += 40;
        return true;
    }
    
    // Check for external exception
    let mask = (registers[SR] >>> 8) & 0b111; // Is this right?
    let int = shared[SHM_INT];
    if(int > mask) {
        time += 44;
        trap(0x18 + int);
        
        // Set the interrupt mask thing
        registers[SR] &= ~0x700;
        registers[SR] |= int << 8;
        shared[SHM_INT] = 0;
    }
    
    // Have we been stopped?
    if(stopped) {
        time += 40;
        return true;
    }
    
    // Get instruction information
    let oldPc = registers[PC];
    if(oldPc & 0b1) {
        console.error("Odd word read at 0x"+oldPc.toString(16)+", crash!");
        crashed = true;
        return true;
    }
    let instruction = readMemory16(oldPc);
    registers[PC] += 2;
    time += 4;
    
    // Decode instruction
    let opcode = getInstruction(instruction);
    
    // Debug information
    heat[opcodes.indexOf(opcode)] ++;
    if(TRACE_STATE) for(let i = 0; i < registers.length; i ++) {
        if(state[i] != registers[i]) {
            log("["+regString(i)+"] 0x"+state[i].toString(16)+" -> 0x"+registers[i].toString(16));
            state[i] = registers[i];
        }
    }
    
    let effectiveAddress = instruction & ~0xffc0;
    
    if(DEBUG || LOGGING) log("-- Running instruction 0x" + instruction.toString(16) +
        " ("+opcode.toString()+") from 0x" + oldPc.toString(16));
    
    if(opcode in opFns) {
        return opFns[opcode].call(this, opcode, instruction, effectiveAddress, oldPc);
    }else{
        console.error("Opcode %o does not have a function", opcode);
        return false;
    }
}

let updateSpans = function() {
    for(let i = 0; i <= 17; i ++) {
        document.querySelector("#r"+i).innerHTML = registers[i].toString(16);
    }
}

let printStack = function() {
    for(let i = -16; i < 16; i ++) {
        if(i == 0) console.log("--");
        console.log(
            (registers[SP] - (i * 4)).toString(16)
            +": "+readMemory32(registers[SP] - (i * 4)).toString(16));
        if(i == 0) console.log("--");
    }
}

let printHeat = function() {
    let results = Array.from(heat)
        .map((x, i) => [i, x])
        .sort((a, b) => b[1] - a[1]);
    
    for(let [op, heat] of results) {
        if(heat) console.log("%o: "+heat, opcodes[op]);
    }
}

let opFns = {};

opFns[MOVE_MOVEA] = function fn_MOVE_MOVEA(opcode, instruction, effectiveAddress, oldPc) {
    let length = 1;
    if((instruction & 0x3000) == 0x3000) {
        length = 2;
    }else if((instruction & 0x3000) == 0x2000) {
        length = 4;
    }
    
    let val = readEa(effectiveAddress, length);
    if(((instruction >> 6) & 0b111) == 0b001) {
        // movea
        val = makeSigned(val, length);
        let destReg = ((instruction >> 9) & 0b111);
        registers[ABASE + destReg] = val;
        log("> movea" + lengthString(length)
            + " " + eaStr(effectiveAddress, length, oldPc)+",a"+destReg);
    }else{
        // move
        let ccr = registers[CCR] & X;
        ccr |= val == 0 ? Z : 0;
        ccr |= isNegative(val, length) ? N : 0;
        registers[CCR] = ccr;
        
        let destEa = (instruction & 0x0fc0) >>> 6;
        destEa = (destEa >>> 3) | ((destEa & 0b111) << 3);
        writeEa(destEa, val, length);
        log("> move" + lengthString(length)
            + " " + eaStr(effectiveAddress, length, oldPc) + "," + eaStr(destEa, length, oldPc));
    }
    return true;
};

opFns[BCC_BRA_BSR] = function fn_BCC_BRA_BSR(opcode, instruction, effectiveAddress, oldPc) {
    let condition = (instruction & 0x0f00) >>> 8;
    let displacement = instruction & 0x00ff;
    let bsr = condition == 0b0001;
    
    if(displacement == 0x00) {
        displacement = pcAndAdvance(2);
        displacement = makeSigned(displacement, 2);
    }else{
        displacement = makeSigned(displacement, 1);
    }
    
    if(bsr) {
        log("> bsr #$" + displacement.toString(16));
    }else{
        log("> b"+conditionStr(condition) + " #$" + displacement.toString(16));
    }
    
    if(!condition || bsr || doCondition(condition, registers[CCR])) {
        if(bsr) {
            registers[SP] -= 4;
            writeMemory32(registers[SP], registers[PC]);
            time += 8;
        }else{
            time += 2;
        }
        
        registers[PC] = oldPc + displacement + 2;
        
    }else{
        time += 4;
    }
    return true;
};

opFns[DBCC] = function fn_DBCC(opcode, instruction, effectiveAddress, oldPc) {
    let reg = instruction & 0b111;
    let condition = (instruction >> 8) & 0b1111;
    let displacement = pcAndAdvance(2);
    
    time += 6;
    
    log("> db"+conditionStr(condition) + " d" + reg + ",#$" + makeSigned(displacement, 2).toString(16));
    
    if(!doCondition(condition, registers[CCR])) {
        let newVal = makeSigned((registers[reg] & 0x0000ffff), 2) - 1;
        registers[reg] = (registers[reg] & 0xffff0000) | (newVal & 0x0000ffff);
        if(newVal != -1) {
            registers[PC] = oldPc + makeSigned(displacement, 2) + 2;
            log("Continuing loop to 0x" + registers[PC].toString(16));
            time -= 4;
        }else{
            time -= 2;
        }
    }
    
    return true;
};

opFns[TST] = function fn_TST(opcode, instruction, effectiveAddress, oldPc) {
    let noEffectiveAddress = instruction & ~effectiveAddress;
    let length = 1;
    if(noEffectiveAddress == 0x4a40) {
        length = 2;
    }else if(noEffectiveAddress == 0x4a80) {
        length = 4;
    }
    
    let val = readEa(effectiveAddress, length);
    
    log("> tst"+lengthString(length) + " "+eaStr(effectiveAddress, length, oldPc));
    
    let ccr = registers[CCR] & X;
    ccr |= val == 0 ? Z : 0;
    ccr |= isNegative(val, length) ? N : 0;
    registers[CCR] = ccr;
    return true;
};

opFns[NOP] = function fn_NOP(opcode, instruction, effectiveAddress, oldPc) {
    log("> nop");
    return true;
};

opFns[ADD_ADDA] = function fn_ADD_ADDA(opcode, instruction, effectiveAddress, oldPc) {
    let register = (instruction >> 9) & 0b111;
    let opmode = (instruction >> 6) & 0b111;
    let length = 0;
    let tmp;
    let addr = false;
    
    [length, tmp] = getOperandLength(instruction, true);
    
    // Do the math
    if((opmode & 0b011) == 0b011) {
        // < ea > + An -> An
        time += 4;
        register += ABASE;
        let ea = makeSigned(readEa(effectiveAddress, length), length);
        
        registers[register] += ea;
        log("> adda"+lengthString(length)+" "+eaStr(effectiveAddress, length)+",a"+(register - ABASE));
    }else{
        // < ea > + Dn -> Dn / < ea >
        let eaAddr = 0;
        let ea = 0;
        if(opmode & 0b100) {
            // Destination is address
            eaAddr = addressEa(effectiveAddress, length);
            ea = readMemory(eaAddr, length);
        }else{
            // Destination is register
            ea = readEa(effectiveAddress, length);
        }
        
        let reg = registers[register] & lengthMask(length);
        tmp[0] = ea;
        tmp[0] += reg;
        
        registers[CCR] = addCcr(ea, reg, tmp[0], length);
        
        if(opmode & 0b100) {
            // Destination is address
            time += 4;
            writeMemory(eaAddr, tmp[0], length);
            log("> add"+lengthString(length)+" d"+(register)+","+eaStr(effectiveAddress, length));
        }else{
            // Destination is register
            registers[register] &= ~lengthMask(length);
            registers[register] |= tmp[0];
            log("> add"+lengthString(length)+" "+eaStr(effectiveAddress, length)+",d"+register);
        }
    }
    
    return true;
};

opFns[CMP_CMPA] = function fn_CMP_CMPA(opcode, instruction, effectiveAddress, oldPc) {
    let register = (instruction >> 9) & 0b111;
    let opmode = (instruction >> 6) & 0b111;
    let length = 0;
    let tmp;
    let addr = false;
    
    [length, tmp] = getOperandLength(instruction, true);
    
    // Do the math
    if((opmode & 0b011) == 0b011) {
        // It's cmpa
        log("> cmpa a"+register+","+eaStr(effectiveAddress, length, oldPc));
        register += ABASE;
    }else{
        log("> cmp d"+register+","+eaStr(effectiveAddress, length, oldPc));
    }
    
    // D/An - < ea >
    if(length == 4) {
        time += 2;
    }
    let eaAddr = 0;
    let ea = readEa(effectiveAddress, length);
    
    let reg = registers[register] & lengthMask(length);
    tmp[0] = reg;
    tmp[0] -= ea;
    
    registers[CCR] = subCcr(reg, ea, tmp[0], length);
    
    return true;
};

opFns[SHIFT_REG] = opFns[SHIFT_MEM] = function fn_SHIFT_MEM(opcode, instruction, effectiveAddress, oldPc) {
    log("> asl/asr/lsl/lsr");
    let size = (instruction >> 6) & 0b11;
    let register = (instruction & 0x0020) != 0;
    let logical;
    
    let [cr, left, length, regNo] = getShift(instruction);
    
    if(size == 0b11) {
        // Memory shift
        let addr = addressEa(effectiveAddress, 2);
        time += 4;
        
        logical = (instruction & 0x0200) != 0;
        
        let val = readMemory16(addr);
        let xc;
        let v;
        if(left) {
            xc = val >> 15;
            v = !((val & 0xc000) == 0x0 || (val & 0xc000) == 0xc000);
            val <<= 1;
        }else{
            xc = val & 0x0001;
            v = 0; // MSB never changes since it is propagated
            if(logical) {
                val >>>= 1;
            }else{
                val = makeSigned(val, 2);
                val >>= 1;
            }
        }
        
        writeMemory(addr, val);
        
        let ccr = 0;
        ccr |= xc ? (C | X) : 0;
        ccr |= isNegative(val, 2) ? N : 0;
        ccr |= (val & 0xffff) == 0 ? Z : 0;
        ccr |= (v && !logical) ? V : 0;
        registers[CCR] = ccr;
    }else{
        // Register shift
        logical = (instruction & 0b1000) != 0;
        
        time += 2 + (2 * cr);
        if(length == 4) time += 2;
        
        let value = registers[regNo] & lengthMask(length);
        let xc;
        let v;
        
        if(cr) {
            if(left) {
                xc = (value & (0x1 << ((length * 8) - 1) >>> (cr - 1))) != 0;
                let vmask = lengthMask(length) & ~(lengthMask(length) >>> cr);
                v = !((value & vmask) == vmask || (value & vmask) == 0);
                value <<= cr;
            }else{
                // Right
                xc = (value & (0x1 << (cr - 1))) != 0;
                v = 0; // MSB never changes since it is propagated
                if(logical) {
                    value >>>= cr;
                }else{
                    value = makeSigned(value, length);
                    value >>= cr;
                }
            }
            
            registers[regNo] = (registers[regNo] & ~lengthMask(length)) | (value & lengthMask(length));
            
            let ccr = 0;
            ccr |= xc ? (C | X) : 0;
            ccr |= isNegative(value, length) ? N : 0;
            ccr |= value == 0 ? Z : 0;
            ccr |= (v && !logical) ? V : 0;
            registers[CCR] = ccr;
        }else{
            let ccr = registers[CCR];
            ccr &= X;
            ccr |= isNegative(value, length) ? N : 0;
            ccr |= value == 0 ? Z : 0;
            registers[CCR] = ccr;
        }
    }
    
    return true;
};

opFns[SUBI] = opFns[SUBQ] = function fn_SUBQ(opcode, instruction, effectiveAddress, oldPc) {
    let length = 0;
    let immediate = 0;
    let tmp;
    let q = (instruction & 0xf100) == 0x5100;
    switch(instruction & 0x00c0) {
        case 0x0000:
            length = 1;
            if(!q) {
                immediate = pcAndAdvance(1);
            }
            tmp = u8;
            break;
        case 0x0040:
            length = 2;
            if(!q) {
                immediate = pcAndAdvance(2);
            }
            tmp = u16;
            break;
        case 0x0080:
            length = 4;
            if(!q) {
                immediate = pcAndAdvance(4);
            }
            tmp = u32;
            break;
    }
    
    if(q) {
        immediate = (instruction >> 9) & 0b111;
        if(immediate == 0) immediate = 8;
    }
    
    if((effectiveAddress & 0b111000) == 0b000000) {
        // To data register
        let reg = registers[effectiveAddress] & lengthMask(length);
        tmp[0] = reg;
        tmp[0] -= immediate;
        
        registers[CCR] = subCcr(reg, immediate, tmp[0], length, true);
        
        if(length == 4) {
            time += 4;
        }
        
        registers[effectiveAddress] &= ~lengthMask(length);
        registers[effectiveAddress] |= tmp[0];
    }else if((effectiveAddress & 0b111000) == 0b001000) {
        // To address register
        if(!q) {
            console.error("Tried to subtract from address register!");
            return false;
        }
        time += 4;
        registers[effectiveAddress] -= immediate;
    }else{
        // To memory address
        let addr = addressEa(effectiveAddress, length);
        let ea = readMemory(addr, length);
        tmp[0] = ea;
        tmp[0] -= immediate;
        
        if(q) {
            time -= 8;
        }
        
        registers[CCR] = subCcr(ea, immediate, tmp[0], length, true);
        
        writeMemory(addr, tmp[0], length);
    }
    
    if(q) {
        log("> subq"+lengthString(length)+
            " #$"+immediate.toString(16)+","+eaStr(effectiveAddress, length, oldPc));
    }else{
        log("> subi"+lengthString(length)+
            " #$"+immediate.toString(16)+","+eaStr(effectiveAddress, length, oldPc));
    }
    
    return true;
};

opFns[MOVE_TO_CCR] = function fn_MOVE_TO_CCR(opcode, instruction, effectiveAddress, oldPc) {
    log("> move to ccr");
    
    let val = readEa(effectiveAddress, 1);
    registers[CCR] &= ~lengthMask(1);
    registers[CCR] |= val;
    
    return true;
};

opFns[MOVE_FROM_SR] = function fn_MOVE_FROM_SR(opcode, instruction, effectiveAddress, oldPc) {
    log("> move from sr");
    let val = registers[SR] | registers[CCR];
    
    if(effectiveAddress & 0b111000) {
        // Memory
        let addr = addressEa(effectiveAddress, 2);
        readMemory16(addr);
        writeMemory(addr, val);
        time += 4;
    }else{
        // Register
        registers[effectiveAddress] &= 0xffff0000;
        registers[effectiveAddress] |= val;
        time += 2;
    }
    return true;
};

opFns[MOVE_TO_SR] = function fn_MOVE_TO_SR(opcode, instruction, effectiveAddress, oldPc) {
    log("> move to sr");
    if(mode != SUPER) {
        trap(EX_PRIV_VIO);
    }else{
        let val = readEa(effectiveAddress, 2);
        
        registers[CCR] = val & 0x00ff;
        registers[SR] = val & 0xff00;
        changeMode((val & S) ? SUPER : USER);
        time += 8;
    }
    return true;
};

opFns[NBCD] = function fn_NBCD(opcode, instruction, effectiveAddress, oldPc) {
    log("> nbcd");
    console.error("NBCD not supported yet");
    return false;
};

opFns[TAS] = function fn_TAS(opcode, instruction, effectiveAddress, oldPc) {
    log("> tas");
    
    // TAS does nothing on a mega drive (at least, version 1 and 2
    
    return true;
};

opFns[JMP] = function fn_JMP(opcode, instruction, effectiveAddress, oldPc) {
    registers[PC] = addressEa(effectiveAddress, 4);
    time += 4;
    
    log("> jmp #$"+eaStr(effectiveAddress, 4, oldPc));
    
    return true;
};

opFns[JSR] = function fn_JSR(opcode, instruction, effectiveAddress, oldPc) {
    let addr = addressEa(effectiveAddress, 4);
    
    registers[SP] -= 4;
    writeMemory32(registers[SP], registers[PC]);
    
    registers[PC] = addr;
    time += 12;
    
    log("> jsr #$"+registers[PC].toString(16));
    
    return true;
};

opFns[ANDI_TO_CCR] = function fn_ANDI_TO_CCR(opcode, instruction, effectiveAddress, oldPc) {
    let instruction2 = pcAndAdvance(2);
    log("> andi to ccr");
    time += 16;
    registers[CCR] &= (instruction2 | 0xff00);
    return true;
};

opFns[ORI_TO_CCR] = function fn_ORI_TO_CCR(opcode, instruction, effectiveAddress, oldPc) {
    let instruction2 = pcAndAdvance(2);
    log("> ori to ccr");
    time += 16;
    registers[CCR] |= (instruction2 & 0xff);
    return true;
};

opFns[EORI_TO_CCR] = function fn_EORI_TO_CCR(opcode, instruction, effectiveAddress, oldPc) {
    let instruction2 = pcAndAdvance(2);
    log("> eori to ccr");
    time += 16;
    registers[CCR] ^= (instruction2 & 0x00ff);
    return true;
};

opFns[ANDI_TO_SR] = opFns[EORI_TO_SR] = opFns[ORI_TO_SR] = function fn_ORI_TO_SR(opcode, instruction, effectiveAddress, oldPc) {
    log("> andi/eori/ori to SR");
    let op = pcAndAdvance(2);
    if(mode != SUPER) {
        trap(EX_PRIV_VIO);
    }else{
        let val = registers[SR] | registers[CCR];
        
        switch(instruction) {
            case 0x027c: val &= op; break; // andi
            case 0x0a7c: val ^= op; break; // eori
            case 0x007c: val |= op; break; // ori;
            default: console.error("andi/eori/ori... How did I get here?"); break;
        }
        
        registers[CCR] = val & 0x00ff;
        registers[SR] = val & 0xff00;
        changeMode((val & S) ? SUPER : USER);
        time += 16;
    }
    return true;
};

opFns[ABCD] = function fn_ABCD(opcode, instruction, effectiveAddress, oldPc) {
    log("> abcd");
    console.error("ABCD opcode not yet supported.");
    return false;
};

opFns[ADDI] = opFns[ADDQ] = function fn_ADDQ(opcode, instruction, effectiveAddress, oldPc) {
    let length = 0;
    let immediate = 0;
    let tmp;
    let q = (instruction & 0xf100) == 0x5000;
    switch(instruction & 0x00c0) {
        case 0x0000:
            length = 1;
            if(!q) {
                immediate = pcAndAdvance(1);
            }
            tmp = u8;
            break;
        case 0x0040:
            length = 2;
            if(!q) {
                immediate = pcAndAdvance(2);
            }
            tmp = u16;
            break;
        case 0x0080:
            length = 4;
            if(!q) {
                immediate = pcAndAdvance(4);
            }
            tmp = u32;
            break;
    }
    
    if(q) {
        immediate = (instruction >> 9) & 0b111;
        if(immediate == 0) immediate = 8;
    }
    
    if((effectiveAddress & 0b111000) == 0b000000) {
        // To data register
        let reg = registers[effectiveAddress] & lengthMask(length);
        tmp[0] = reg;
        tmp[0] += immediate;
        
        registers[CCR] = addCcr(immediate, reg, tmp[0], length);
        
        if(length == 4) {
            time += 4;
        }
        
        registers[effectiveAddress] &= ~lengthMask(length);
        registers[effectiveAddress] |= tmp[0];
    }else if((effectiveAddress & 0b111000) == 0b001000) {
        // To address register
        if(!q) {
            console.error("Tried to add to an address register!");
            return false;
        }
        time += 4;
        registers[effectiveAddress] += immediate;
    }else{
        // To memory address
        let addr = addressEa(effectiveAddress, length);
        let ea = readMemory(addr, length);
        tmp[0] = ea;
        tmp[0] += immediate;
        
        if(q) {
            time -= 8;
        }
        
        registers[CCR] = addCcr(immediate, ea, tmp[0], length);
        
        writeMemory(addr, tmp[0], length);
    }
    
    if(q) {
        log("> addq"+lengthString(length)+
            " #$"+immediate.toString(16)+","+eaStr(effectiveAddress, length, oldPc));
    }else{
        log("> addi"+lengthString(length)+
            " #$"+immediate.toString(16)+","+eaStr(effectiveAddress, length, oldPc));
    }
    
    return true;
};

opFns[ADDX] = function fn_ADDX(opcode, instruction, effectiveAddress, oldPc) {
    log("> addx");
    console.error("ADDX opcode not yet supported.");
    return false;
};

opFns[AND] = opFns[EOR] = opFns[OR] = function fn_OR(opcode, instruction, effectiveAddress, oldPc) {
    let register = (instruction >> 9) & 0b111;
    let opmode = (instruction >> 6) & 0b111;
    let length = 0;
    let tmp;
    
    [length, tmp] = getOperandLength(instruction, false);
    
    let istr = "???";
    switch(instruction & 0xf000) {
        case 0xc000: istr = "and"; break;
        case 0xb000: istr = "eor"; break;
        case 0x8000: istr = "or"; break;
    }
    
    // Do the math
    let eaAddr = 0;
    let ea = 0;
    if(opmode & 0b100) {
        // -> < ea >
        if((effectiveAddress & 0b111000) == 0) {
            // Register
            ea = registers[effectiveAddress];
        }else{
            // Memory
            eaAddr = addressEa(effectiveAddress, length);
            ea = readMemory(eaAddr, length);
            time += 4;
        }
    }else{
        // -> r
        ea = readEa(effectiveAddress, length);
    }
    
    let reg = registers[register];
    tmp[0] = ea;
    switch(instruction & 0xf000) {
        case 0xc000: tmp[0] &= reg; break; // and
        case 0xb000: tmp[0] ^= reg; break; // eor
        case 0x8000: tmp[0] |= reg; break; // or
        default: console.error("and/eor/or... How did I get here?");
    }
    
    let ccr = registers[CCR] & X;
    ccr |= (tmp[0] & (1 << ((length * 8) - 1))) ? N : 0;
    ccr |= tmp[0] == 0 ? Z : 0;
    registers[CCR] = ccr;
    
    if(opmode & 0b100) {
        // -> < ea >
        if(length == 4) {
            time += 2;
            if((instruction & 0xf000) == 0xb000) {
                // eor
                time += 2;
            }
        }
        
        if((effectiveAddress & 0b111000) == 0) {
            // Register
            registers[effectiveAddress] = (registers[effectiveAddress] & ~lengthMask(length)) | tmp[0];
        }else{
            // Address
            time += 4;
            if(length == 4) time += 4;
            
            writeMemory(eaAddr, tmp[0], length);
        }
        
        log("> "+istr+lengthString(length)+" d"+register+","+eaStr(effectiveAddress, length, oldPc));
    }else{
        // -> r
        registers[register] = (registers[register] & ~lengthMask(length)) | tmp[0];
        if((instruction & 0xf000) == 0xb000) {
            // eor
            console.error("Tried to write the result of an eor to non EA destination.");
            return false;
        }
        log("> "+istr+lengthString(length)+" "+eaStr(effectiveAddress, length, oldPc)+",d"+register);
    }
    
    return true;
};

opFns[ANDI] = opFns[EORI] = opFns[ORI] = function fn_ORI(opcode, instruction, effectiveAddress, oldPc) {
    let [length, immediate, tmp] = getImmediate(instruction);
    
    let istr = "???";
    switch(instruction & 0xff00) {
        case 0x0200: istr = "andi"; break;
        case 0x0a00: istr = "eori"; break;
        case 0x0000: istr = "ori"; break;
    }
    
    if((effectiveAddress & 0b111000) == 0b000000) {
        // To data register
        let reg = registers[effectiveAddress] & lengthMask(length);
        let val = immediate;
        
        switch(instruction & 0xff00) {
            case 0x0200: val &= reg; break; // andi
            case 0x0a00: val ^= reg; break; // eori
            case 0x0000: val |= reg; break; // ori
            default: console.error("andi/eori/ori... How did I get here?");
        }
        
        val &= lengthMask(length);
        
        registers[effectiveAddress] &= ~lengthMask(length);
        registers[effectiveAddress] |= val;
        
        let ccr = registers[CCR] & X;
        ccr |= isNegative(val, length) ? N : 0;
        ccr |= val == 0 ? Z : 0;
        registers[CCR] = ccr;
        
        if(length == 4) time += 4;
        log("> "+istr+lengthString(length)+" #$"+immediate.toString(16)+",d"+effectiveAddress);
    }else{
        // To memory address
        let addr = addressEa(effectiveAddress, length);
        let ea = readMemory(addr, length);
        tmp[0] = immediate;
        switch(instruction & 0xff00) {
            case 0x0200: tmp[0] &= ea; break; // andi
            case 0x0a00: tmp[0] ^= ea; break; // eori
            case 0x0000: tmp[0] |= ea; break; // ori
            default: console.error("andi/eori/ori... How did I get here?");
        }
        
        let ccr = registers[CCR] & X;
        ccr |= isNegative(tmp[0], length) ? N : 0;
        ccr |= (tmp[0]) == 0 ? Z : 0;
        registers[CCR] = ccr;
        
        time += 4;
        if(length == 4) time += 4;
        writeMemory(addr, tmp[0], length);
        
        log("> "+istr+lengthString(length)+
            " #$"+immediate.toString(16)+","+eaStr(effectiveAddress, length, oldPc));
    }
    
    return true;
};

opFns[BMOD_REG] = opFns[BMOD_IMM] = function fn_BMOD_IMM(opcode, instruction, effectiveAddress, oldPc) { // btst/bchg/bclr/bset
    let chg = (instruction & 0x00c0) == 0x0040;
    let clr = (instruction & 0x00c0) == 0x0080;
    let set = (instruction & 0x00c0) == 0x00c0;
    
    let bitNo;
    let rstr = "";
    if(instruction & 0x0100) {
        // Register
        bitNo = registers[(instruction >> 9) & 0b111];
        rstr = "r"+((instruction >> 9) & 0b111);
    }else{
        // Immediate
        bitNo = pcAndAdvance(1);
        rstr = "#$"+bitNo.toString(16);
    }
    
    let mask;
    let value;
    if((effectiveAddress & 0b111000) == 0b000000) {
        // Register
        mask = 1 << (bitNo % 32);
        value = registers[effectiveAddress];
        
        if(chg) {
            registers[effectiveAddress] ^= mask;
        }else if(clr) {
            time += 2;
            registers[effectiveAddress] &= ~mask;
        }else if(set) {
            registers[effectiveAddress] |= mask;
        }else{
            time -= 2;
        }
    }else{
        // Address
        mask = 1 << (bitNo % 8);
        let addr = addressEa(effectiveAddress, 1)
        value = readMemory8(addr);
        time += 4;
        
        if(chg) {
            writeMemory8(addr, value ^ mask);
        }else if(clr) {
            writeMemory8(addr, value & ~mask);
        }else if(set) {
            writeMemory8(addr, value | mask);
        }else{
            time -= 4;
        }
    }
    
    let ccr = registers[CCR];
    ccr &= ~Z;
    ccr |= (value & mask) ? 0 : Z;
    registers[CCR] = ccr;
    
    let name = "btst";
    if(chg) {
        name = "bchg";
    }else if(clr) {
        name = "bclr";
    }else if(set) {
        name = "bset";
    }
    
    log("> "+name+" "+rstr+","+eaStr(effectiveAddress, 1, oldPc));
    
    return true;
};

opFns[CHK] = function fn_CHK(opcode, instruction, effectiveAddress, oldPc) {
    log("> chk");
    time += 6;
    let register = (instruction >> 9) & 0b111;
    let upper = makeSigned(readEa(effectiveAddress, 2), 2);
    let comp = makeSigned(registers[register] & lengthMask(2), 2);
    
    if(comp < 0 || comp > upper) {
        let ccr = registers[CCR] & X;
        ccr |= (comp < 0) ? N : 0;
        registers[CCR] = ccr;
        
        trap(EX_CHK);
    }
};

opFns[CLR] = function fn_CLR(opcode, instruction, effectiveAddress, oldPc) {
    log("> clr");
    let [length, tmp] = getOperandLength(instruction, false);
    
    if((effectiveAddress & 0b111000) == 0b000000) {
        // Register
        registers[effectiveAddress] &= ~lengthMask(length);
        if(length == 4) time += 2;
    }else{
        // Address
        let addr = addressEa(effectiveAddress, length);
        readMemory(addr, length); // A read still occurs according to the manual
        writeMemory(addr, 0, length);
        time += 4;
        if(length == 4) time += 4;
    }
    
    let ccr = registers[CCR] & X;
    ccr |= Z;
    registers[CCR] = ccr;
    
    return true;
};

opFns[CMPM] = function fn_CMPM(opcode, instruction, effectiveAddress, oldPc) {
    log("> cmpm");
    let src = instruction & 0b111;
    let dst = (instruction >> 9) & 0b111;
    let length = 0;
    let tmp;
    let sm;
    let dm;
    
    [length, tmp] = getOperandLength(instruction, true);
    
    sm = readEa(0b011000 & src, length);
    dm = readEa(0b011000 & dst, length);
    
    tmp[0] = dm;
    tmp[0] -= sm;
    
    registers[CCR] = subCcr(dm, sm, tmp[0], length, false);
    
    return true;
};

opFns[CMPI] = function fn_CMPI(opcode, instruction, effectiveAddress, oldPc) {
    let [length, immediate, tmp] = getImmediate(instruction);
    
    if(length == 4 && (effectiveAddress & 0b111000) == 0) {
        time += 2;
    }
    
    let ea = readEa(effectiveAddress, length);
    tmp[0] = ea;
    tmp[0] -= immediate;
    
    registers[CCR] = subCcr(ea, immediate, tmp[0], length);
    
    log("> cmpi" + lengthString(length) +
        " #$"+immediate.toString(16) + "," + eaStr(effectiveAddress, length, oldPc));
    
    return true;
};

opFns[DIVS] = function fn_DIVS(opcode, instruction, effectiveAddress, oldPc) {
    log("> divs");
    time += 154;
    let source = makeSigned(readEa(effectiveAddress, 2), 2);
    let reg = (instruction >> 9) & 0b111;
    let dest = makeSigned(registers[reg], 4); // "divides a long word by a word"
    
    if(source == 0) {
        trap(EX_DIV0);
        return true;
    }
    
    let result = ~~(dest / source);
    let remainder = (dest % source) * (dest < 0 ? -1 : 1);
    
    let ccr = registers[CCR] & X;
    ccr |= result == 0 ? Z : 0;
    ccr |= result < 0 ? N : 0;
    if((result > 0x7fff) || (result < -0x7fff)) {
        // Overflow!
        ccr |= V;
    }else{
        registers[reg] = ((remainder & 0xffff) << 16) | (result & 0xffff);
    }
    
    registers[CCR] = ccr;
    
    return true;
};

opFns[DIVU] = function fn_DIVU(opcode, instruction, effectiveAddress, oldPc) {
    log("> divu");
    time += 136;
    let source = readEa(effectiveAddress, 2);
    let reg = (instruction >> 9) & 0b111;
    let dest = registers[reg]; // "divides a long word by a word"
    
    if(source == 0) {
        trap(EX_DIV0);
        return true;
    }
    
    let result = dest / source;
    let remainder = dest % source;
    
    let ccr = registers[CCR] & X;
    ccr |= result == 0 ? Z : 0;
    ccr |= result < 0 ? N : 0;
    if(result > 0xffff) {
        // Overflow!
        ccr |= V;
    }else{
        registers[reg] = ((remainder & 0xffff) << 16) | (result & 0xffff);
    }
    
    registers[CCR] = ccr;
    
    return true;
};

opFns[EXG] = function fn_EXG(opcode, instruction, effectiveAddress, oldPc) {
    log("> exg");
    time += 2;
    let mode = (instruction >> 3) & 0b11111;
    let rx = (instruction >> 9) & 0b111;
    let ry = instruction & 0b111;
    
    if((mode & 0b1) == 0b1) {
        ry += ABASE;
    }
    
    if(mode == 0b01001) {
        rx += ABASE;
    }
    
    let tmp = registers[ry];
    registers[ry] = registers[rx];
    registers[rx] = tmp;
    
    return true;
};

opFns[EXT] = function fn_EXT(opcode, instruction, effectiveAddress, oldPc) {
    let reg = instruction & 0b111;
    let dat = 0;
    
    if(instruction & 0x0040) {
        // Word > long
        dat = makeSigned(registers[reg] & lengthMask(2), 2);
        registers[reg] = dat & lengthMask(4);
        
        log("> ext.l d"+reg);
    }else{
        // Byte > word
        dat = makeSigned(registers[reg] & lengthMask(1), 1);
        registers[reg] &= ~lengthMask(2);
        registers[reg] |= dat & lengthMask(2);
        log("> ext.w d"+reg);
    }
    
    let ccr = registers[CCR] & X;
    ccr |= dat == 0 ? Z : 0;
    ccr |= dat < 0 ? N : 0;
    registers[CCR] = ccr;
    return true;
};

opFns[ILLEGAL] = function fn_ILLEGAL(opcode, instruction, effectiveAddress, oldPc) {
    log("> illegal");
    
    console.error("Illegal instruction 0x"+instruction.toString(16));
    
    switch(options.invalidOp) {
        case "crash":
            crashed = true;
            break;
        
        case "ignore":
            // do nothing
            break;
            
        case "trap":
            trap(EX_ILLEGAL);
            break;
    }
    
    return true;
};

opFns[LEA] = function fn_LEA(opcode, instruction, effectiveAddress, oldPc) {
    log("> lea");
    // TODO: Use only supported modes
    let reg = (instruction & 0x0e00) >>> 9;
    registers[ABASE + reg] = addressEa(effectiveAddress, 4);
    return true;
};

opFns[LINK] = function fn_LINK(opcode, instruction, effectiveAddress, oldPc) {
    log("> link");
    let reg = (instruction & 0b111) + ABASE;
    let displacement = makeSigned(pcAndAdvance(2), 2);
    
    registers[SP] -= 4;
    writeMemory(registers[SP], registers[reg], 4);
    registers[reg] = registers[SP];
    registers[SP] += displacement;
    return true;
};

opFns[MOVEQ] = function fn_MOVEQ(opcode, instruction, effectiveAddress, oldPc) {
    let data = instruction & 0x00ff;
    let reg = (instruction >> 9) & 0b111;
    
    registers[reg] = makeSigned(data, 1);
    
    let ccr = registers[CCR] & X;
    ccr |= isNegative(registers[reg], 4) ? N : 0;
    ccr |= registers[reg] == 0 ? Z : 0;
    registers[CCR] = ccr;
    
    log("> moveq #$"+data.toString(16)+",d"+reg);
    
    return true;
};

opFns[MOVEP] = function fn_MOVEP(opcode, instruction, effectiveAddress, oldPc) {
    log("> movep");
    console.error("MOVEP not supported");
};

opFns[MULS] = function fn_MULS(opcode, instruction, effectiveAddress, oldPc) {
    log("> muls");
    let register = (instruction >> 9) & 0b111;
    time += 66;
    
    let a = makeSigned(readEa(effectiveAddress, 2), 2);
    let b = makeSigned(registers[register] & 0xffff, 2);
    let result = a * b;
    
    registers[register] = result;
    
    let ccr = registers[CCR] & X;
    ccr |= result == 0 ? Z : 0;
    ccr |= result < 0 ? N : 0;
    registers[CCR] = ccr;
    
    return true;
};

opFns[MULU] = function fn_MULU(opcode, instruction, effectiveAddress, oldPc) {
    log("> mulu");
    let register = (instruction >> 9) & 0b111;
    time += 66;
    
    let a = readEa(effectiveAddress, 2);
    let b = registers[register] & 0xffff;
    let result = a * b;
    
    registers[register] = result;
    
    let ccr = registers[CCR] & X;
    ccr |= result == 0 ? Z : 0;
    ccr |= (result & 0x80000000) ? N : 0;
    registers[CCR] = ccr;
    
    return true;
};

opFns[MOVE_USP] = function fn_MOVE_USP(opcode, instruction, effectiveAddress, oldPc) {
    log("> move usp");
    if(mode == USER) {
        trap(EX_PRIV_VIO);
    }else{
        let reg = ABASE + (instruction & 0b111);
        
        if(instruction & 0x0080) {
            // Stack > address
            registers[reg] = oldSp;
        }else{
            // Address > stack
            oldSp = registers[reg];
        }
    }
    return true;
};

opFns[NEG] = opFns[NEGX] = function fn_NEGX(opcode, instruction, effectiveAddress, oldPc) {
    log("> neg/negx");
    let [length, tmp] = getOperandLength(instruction, false);
    let x = (instruction & 0x0400) == 0;
    let xdec = (x && (registers[CCR] & X)) ? 1 : 0;
    
    tmp[0] = 0;
    if(effectiveAddress & 0b111000) {
        // Memory location
        let addr = addressEa(effectiveAddress, length);
        let val = readMemory(addr, length);
        
        tmp[0] -= val;
        
        registers[CCR] = subCcr(0, val, tmp[0], length, true, x);
        
        tmp[0] -= xdec;
        
        writeMemory(addr, tmp[0], length);
        time += 4;
        if(length == 4) time += 4;
    }else{
        // Register
        let val = registers[effectiveAddress] & lengthMask(length);
        
        tmp[0] -= val;
        
        registers[CCR] = subCcr(0, val, tmp[0], length, true, x);
        
        tmp[0] -= xdec;
        
        registers[effectiveAddress] &= ~lengthMask(length);
        registers[effectiveAddress] |= tmp[0];
        
        if(length == 4) time += 2;
    }
    
    return true;
};

opFns[PEA] = function fn_PEA(opcode, instruction, effectiveAddress, oldPc) {
    log("> pea");
    
    registers[SP] -= 4;
    writeMemory32(registers[SP], addressEa(effectiveAddress, 4), 4);
    return true;
};

opFns[SUB_SUBA] = function fn_SUB_SUBA(opcode, instruction, effectiveAddress, oldPc) {
    log("> sub/suba");
    let register = (instruction >> 9) & 0b111;
    let opmode = (instruction >> 6) & 0b111;
    let length = 0;
    let tmp;
    
    [length, tmp] = getOperandLength(instruction, true);
    
    // Do the math
    if((opmode & 0b011) == 0b011) {
        // < ea > - An -> An
        time += 4;
        register += ABASE;
        let ea = makeSigned(readEa(effectiveAddress, length), length);
        
        registers[register] -= ea;
    }else{
        // < ea > + Dn -> Dn / < ea >
        let eaAddr = 0;
        let ea = 0;
        let reg = registers[register] & lengthMask(length);
        
        if(opmode & 0b100) {
            // < ea > - dn -> < ea >
            eaAddr = addressEa(effectiveAddress, length);
            ea = readMemory(eaAddr, length);
            tmp[0] = ea;
            tmp[0] -= reg;
            
            registers[CCR] = subCcr(ea, reg, tmp[0], length, true);
            
            time += 4;
            writeMemory(eaAddr, tmp[0], length);
        }else{
            // dn - < ea > -> dn
            ea = readEa(effectiveAddress, length);
            
            tmp[0] = reg;
            tmp[0] -= ea;
            
            registers[CCR] = subCcr(reg, ea, tmp[0], length, true);
            
            registers[register] &= ~lengthMask(length);
            registers[register] |= tmp[0];
        }
    }
    
    return true;
};

opFns[SUBX] = function fn_SUBX(opcode, instruction, effectiveAddress, oldPc) {
    log("> subx");
    console.error("SUBX opcode not yet supported.");
    return false;
};

opFns[NOT] = function fn_NOT(opcode, instruction, effectiveAddress, oldPc) {
    let [length, tmp] = getOperandLength(instruction, false);
    let val = 0;
    
    if(effectiveAddress & 0b111000) {
        // Memory location
        let addr = addressEa(effectiveAddress, length);
        val = readMemory(addr, length);
        
        writeMemory(addr, ~val, length);
        time += 4;
        if(length == 4) time += 4;
    }else{
        // Register
        val = registers[effectiveAddress] & lengthMask(length);
        
        registers[effectiveAddress] &= ~lengthMask(length);
        registers[effectiveAddress] |= ~val & lengthMask(length);
        
        if(length == 4) time += 2;
    }
    
    let ccr = registers[CCR] & X;
    ccr |= val == 0 ? Z : 0;
    ccr |= isNegative(~val, length) ? N : 0;
    registers[CCR] = ccr;
    
    log("> not"+lengthString(length)+" "+eaStr(effectiveAddress));
    
    return true;
};

opFns[MOVEM_TO_REG] = function fn_MOVEM_TO_REG(opcode, instruction, effectiveAddress, oldPc) {
    let noEffectiveAddress = instruction & ~effectiveAddress;
    let length = 2;
    if(noEffectiveAddress == 0x4cc0) {
        length = 4;
    }
    
    let mask = pcAndAdvance(2);
    
    let val = 0;
    let inc = false;
    let addr = 0;
    if((effectiveAddress & 0b111000) == 0b011000) {
        inc = true;
    }else{
        addr = addressEa(effectiveAddress, length);
    }
    
    time += 8;
    for(let a = 0; a <= 15; a ++) {
        if(mask & (1 << a)) {
            if(inc) {
                val = readEa(effectiveAddress, length);
            }else{
                val = readMemory(addr, length);
                addr += length;
            }
            
            registers[a] = makeSigned(val, length);
        }
    }
    
    log("> movem"+lengthString(length)+" "+eaStr(effectiveAddress)+",#$"+mask.toString(16));
    
    return true;
};

opFns[MOVEM_TO_MEM] = function fn_MOVEM_TO_MEM(opcode, instruction, effectiveAddress, oldPc) {
    let noEffectiveAddress = instruction & ~effectiveAddress;
    let length = 2;
    if(noEffectiveAddress == 0x48c0) {
        length = 4;
    }
    
    let mask = pcAndAdvance(2);
    
    let val = 0;
    let dec = false;
    let addr = 0;
    if((effectiveAddress & 0b111000) == 0b100000) {
        dec = true;
    }else{
        addr = addressEa(effectiveAddress, length);
    }
    
    let reg = effectiveAddress & 0b111;
    let init = registers[ABASE + reg];
    time += 4;
    for(let a = 0; a <= 15; a ++) {
        if(mask & (1 << a)) {
            let r = dec ? 15 - a : a;
            
            if(r == reg + ABASE) {
                val = init;
            }else{
                val = registers[r];
            }
            
            if(dec) {
                writeEa(effectiveAddress, val, length);
            }else{
                writeMemory(addr, val, length);
                addr += length;
            }
        }
    }
    
    log("> movem"+lengthString(length)+" #$"+mask.toString(16)+","+eaStr(effectiveAddress));
    
    return true;
};

opFns[RESET] = function fn_RESET(opcode, instruction, effectiveAddress, oldPc) {
    log("> reset");
    // Apparently this has no effect?
    return true;
};

opFns[ROL_ROR_REG] = function fn_ROL_ROR_REG(opcode, instruction, effectiveAddress, oldPc) {
    log("> rol/ror (register)");
    let [cr, left, length, regNo] = getShift(instruction);
    
    time += 2 + (2 * cr);
    if(length == 4) time += 2;
    
    let value = registers[regNo] & lengthMask(length);
    let tmp = 0;
    
    for(let i = 0; i < cr; i ++) {
        if(left) {
            tmp = value >>> (length * 8 - 1);
            value <<= 1;
            value |= tmp;
            value &= lengthMask(length);
        }else{
            // Right
            tmp = value & 0b1;
            value >>>= 1;
            value |= (tmp << (length * 8 - 1));
        }
    }
    
    registers[regNo] = (registers[regNo] & ~lengthMask(length)) | (value & lengthMask(length));
    
    let ccr = registers[CCR] & X;
    ccr |= tmp ? C : 0;
    ccr |= isNegative(value, length) ? N : 0;
    ccr |= value == 0 ? Z : 0;
    registers[CCR] = ccr;
    
    return true;
};

opFns[ROL_ROR_MEM] = function fn_ROL_ROR_MEM(opcode, instruction, effectiveAddress, oldPc) {
    log("> rol/ror (memory)");
    console.error("ROL/ROR with memory not implemented yet");
    return false;
};

opFns[ROXL_ROXR_REG] = function fn_ROXL_ROXR_REG(opcode, instruction, effectiveAddress, oldPc) {
    log("> roxl/roxr (register)");
    let [cr, left, length, regNo] = getShift(instruction);
    
    time += 2 + (2 * cr);
    if(length == 4) time += 2;
    
    let value = registers[regNo] & lengthMask(length);
    let tmp = 0;
    let tmp2 = 0;
    let x = (registers[CCR] & X) ? 1 : 0;
    
    for(let i = 0; i < cr; i ++) {
        if(left) {
            tmp = x;
            x = value >>> (length * 8 - 1);
            value <<= 1;
            value |= tmp;
            value &= lengthMask(length);
        }else{
            // Right
            tmp = x;
            x = value & 0b1;
            value >>>= 1;
            value |= (tmp << (length * 8 - 1));
        }
    }
    
    registers[regNo] = (registers[regNo] & ~lengthMask(length)) | (value & lengthMask(length));
    
    if(cr == 0) {
        let ccr = registers[CCR] & X;
        ccr |= ccr ? C : 0; // Set to the value of the extend bit
        ccr |= isNegative(value, length) ? N : 0;
        ccr |= value == 0 ? Z : 0;
        registers[CCR] = ccr;
    }else{
        let ccr = 0;
        ccr |= x ? (C | X) : 0;
        ccr |= isNegative(value, length) ? N : 0;
        ccr |= value == 0 ? Z : 0;
        registers[CCR] = ccr;
    }
    
    return true;
};

opFns[ROXL_ROXR_MEM] = function fn_ROXL_ROXR_MEM(opcode, instruction, effectiveAddress, oldPc) {
    log("> roxl/roxr (memory)");
    console.error("ROXL/ROXR with memory not implemented yet");
    return false;
};

opFns[RTE] = function fn_RTE(opcode, instruction, effectiveAddress, oldPc) {
    log("> rte");
    
    let sr = readMemory16(registers[SP]);
    registers[CCR] = sr & 0x00ff;
    registers[SR] = sr & 0xff00;
    registers[SP] += 2;
    
    registers[PC] = readMemory32(registers[SP]);
    registers[SP] += 4;
    
    changeMode(sr & S ? SUPER : USER);
    time += 16;
    
    return true;
};

opFns[RTR] = function fn_RTR(opcode, instruction, effectiveAddress, oldPc) {
    log("> rtr");
    
    time += 16;
    registers[CCR] = readMemory16(registers[SP]);
    registers[SP] += 2;
    registers[PC] = readMemory32(registers[SP]);
    registers[SP] += 4;
    
    return true;
};

opFns[RTS] = function fn_RTS(opcode, instruction, effectiveAddress, oldPc) {
    log("> rts");
    
    time += 12;
    registers[PC] = readMemory32(registers[SP]);
    registers[SP] += 4;
    
    return true;
};

opFns[SBCD] = function fn_SBCD(opcode, instruction, effectiveAddress, oldPc) {
    log("> sbcd");
    console.error("SBCD not implemented yet");
    return false;
};

opFns[SCC] = function fn_SCC(opcode, instruction, effectiveAddress, oldPc) {
    log("> scc");
    
    let condition = (instruction & 0x0f00) >>> 8;
    
    if(effectiveAddress & 0b111000) {
        // Memory
        let addr = addressEa(effectiveAddress, 1);
        readMemory8(addr, 1); // "A memory address is read before it is written"
        if(doCondition(condition, registers[CCR])) {
            writeMemory8(addr, 0xff, 1);
        }else{
            writeMemory8(addr, 0x00, 1);
        }
        time += 8;
    }else{
        // Register
        if(doCondition(condition, registers[CCR])) {
            writeEa(effectiveAddress, 0xff, 1);
            time += 2;
        }else{
            writeEa(effectiveAddress, 0x00, 1);
        }
    }
    
    
    return true;
};

opFns[STOP] = function fn_STOP(opcode, instruction, effectiveAddress, oldPc) {
    log("> stop");
    
    if(mode != SUPER) {
        trap(EX_PRIV_VIO);
    }else{
        let val = pcAndAdvance(2);
        
        registers[CCR] = val & 0x00ff;
        registers[SR] = val & 0xff00;
        changeMode((val & S) ? SUPER : USER);
        time += 8;
        
        stopped = true;
    }
    return true;
};

opFns[SWAP] = function fn_SWAP(opcode, instruction, effectiveAddress, oldPc) {
    log("> swap");
    let reg = instruction & 0b111;
    
    let high = registers[reg] << 16;
    registers[reg] >>>= 16;
    registers[reg] |= high;
    
    let ccr = registers[CCR] & X;
    ccr |= registers[reg] == 0 ? Z : 0;
    ccr |= isNegative(registers[reg], 4) ? N : 0;
    registers[CCR] = ccr;
    
    return true;
};

opFns[TRAP] = function fn_TRAP(opcode, instruction, effectiveAddress, oldPc) {
    log("> trap");
    // TODO: Timing
    trap((instruction & 0x0f) + 32);
    
    return true;
};

opFns[TRAPV] = function fn_TRAPV(opcode, instruction, effectiveAddress, oldPc) {
    log("> trapv");
    // TODO: Timing
    trap(EX_TRAPV);
    
    return true;
};

opFns[UNLK] = function(opcode, instruction, effectiveAddress, oldPc) {
    log("> unlk");
    time += 8;
    
    let reg = ABASE + (instruction & 0b111);
    
    registers[SP] = registers[reg];
    registers[reg] = readMemory32(registers[SP]);
    registers[SP] += 4;
    
    return true;
};
