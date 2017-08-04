"use strict";

const MSG_INIT = 0;
const MSG_RAF = 1;

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

let raf = function() {
    // ...
}
