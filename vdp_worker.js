"use strict";

const MSG_INIT = 0;
const MSG_RAF = 1;
const MSG_FRAME = 2;

console.log("VDP Worker Started!");

const RM1 = 0;
const RM2 = 1;
const RPLANEA_NT = 2;
const RWINDOW_NT = 3;
const RPLANEB_NT = 4;
const RSPRITE_NT = 5;
const RSP_GEN = 6;
const RBACKGROUND = 7;
const RUNUSEDA = 8;
const RUNUSEDB = 9;
const RHORINT_C = 10;
const RM3 = 11;
const RM4 = 12;
const RHORSCROLL = 13;
const RNT_GEN = 14;
const RAUTOINC = 15;
const RPLANE_SIZE = 16;
const RWPLANE_HORPOS = 17;
const RWPLANE_VERPOS = 18;
const RDMAL_LO = 19;
const RDMAL_HI = 20;
const RDMAS_LO = 21;
const RDMAS_MI = 22;
const RDMAS_HI = 23;
const RSTATUS = 24;
const REX = 26;

let vram = null;
let cram = null;
let vsram = null;
let inited = false;
let registers = null;

self.onmessage = function(e) {
    let data = e.data[1];
    
    switch(e.data[0]) {
        case MSG_INIT:
            registers = new Uint8Array(data[0]);
            vram = new DataView(data[1]);
            cram = new DataView(data[2]);
            vsram = new DataView(data[3]);
            break;
        
        case MSG_RAF:
            raf();
            break;
    }
}

// These return cells
let getDisplayCols = function() {
    if(registers[RM4] & 0x01) {
        return 40;
    }else{
        return 32;
    }
}

let getDisplayRows = function() {
    if(registers[RM2] & 0x08) {
        return 30;
    }else{
        return 28;
    }
}

let raf = function() {
    // ...
    let [frame, width, height] = doFrame();
    
    // VBlank interrupt
    if(registers[RM2] & 0x20) {
        registers[REX] = 6;
    }
    
    // Send the data back
    postMessage([MSG_FRAME, [frame, width, height]], [frame]);
}

// Converts the colour into a 0xrrggbbaa 32 bit int
let paletteRead = function(id, allowTransparent) {
    if(allowTransparent && !(id % 16)) {
        return 0x00000000;
    }else{
        let clr = cram.getUint16(id * 2, false);
        
        let procC = function(offset) {
            let c = (clr >> 1) & 0b111;
            
            switch(c) {
                case 0b000: return 0;
                case 0b111: return 0xff;
                default: return ~~(0xff / 0b111) * c;
            }
        }
        
        let r = procC(1);
        let g = procC(5);
        let b = procC(9);
        
        return (r << 12) | (g << 8) | (b << 4) | 0xff; 
    }
}

let doFrame = function() {
    let rows = getDisplayRows();
    let cols = getDisplayCols();
    let totalPx = rows * cols * 8 * 8;
    let display8 = new Uint8ClampedArray(rows * cols * 4 * 8 * 8);
    let dv = new DataView(display8.buffer);
    
    // Fill in the background first
    let bground = paletteRead(registers[RBACKGROUND], false);
    for(let i = 0; i < totalPx; i ++) {
        dv.setUint32(i * 4, bground);
    }
    
    return [display8.buffer, cols * 8, rows * 8];
}
