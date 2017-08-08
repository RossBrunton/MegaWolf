"use strict";

const MSG_INIT = 0;
const MSG_RAF = 1;
const MSG_FRAME = 2;
const MSG_RETBUF = 3;

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

let displayBuffer = null;
let waitingForBuffer = false;

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
        
        case MSG_RETBUF:
            displayBuffer = data;
            waitingForBuffer = false;
            break;
        
        default:
            console.error("VDP worker got unknown message type "+e.data[0]);
            break;
    }
}

// These return number cells
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

let getPlaneCols = function() {
    return [32, 64, 64, 128][registers[RPLANE_SIZE] & 0b11];
}

let getPlaneRows = function() {
    return [32, 64, 64, 128][(registers[RPLANE_SIZE] >> 4) & 0b11];
}

let raf = function() {
    if(!waitingForBuffer) { // If we don't have our buffer, do nothing
        let frame = doFrame();
        
        // Send the data back
        waitingForBuffer = true;
        postMessage([MSG_FRAME, [frame, width, height]], [frame]);
    }
    
    // VBlank interrupt
    if(registers[RM2] & 0x20) {
        registers[REX] = 6;
    }
}

// Converts the colour into a 0xrrggbbaa 32 bit int
let paletteRead = function(id, allowTransparent) {
    if(allowTransparent && !(id % 16)) {
        return 0x00000000;
    }else{
        let clr = cram.getUint16(id * 2, false);
        
        let procC = function(offset) {
            let c = (clr >> offset) & 0b1111;
            if(clr > 0b0100) clr ++;;
            
            return c | (c << 4);
        }
        
        let r = procC(0);
        let g = procC(4);
        let b = procC(8);
        
        return (r << 24) | (g << 16) | (b << 8) | 0xff; 
    }
}


// Frame drawing state
let rows, cols;
let prows, pcols; // Plane sizes
let width, height; // Of the canvas
let px, py; // On the plane
let cx, cy; // On the canvas
let background; // Background colour
let first; // First plane?

let doFrame = function() {
    rows = getDisplayRows();
    cols = getDisplayCols();
    prows = getPlaneRows();
    pcols = getPlaneCols();
    width = cols * 8;
    height = rows * 8;
    let totalPx = (rows * 8) * (cols * 8);
    if(!displayBuffer || displayBuffer.byteLength != totalPx * 4) {
        if(displayBuffer) console.log("Recreating buffer " + displayBuffer.byteLength + " --> "+(totalPx * 4));
        displayBuffer = new ArrayBuffer(totalPx * 4);
    }
    let dv = new DataView(displayBuffer);
    
    // Fill in the background first
    background = paletteRead(registers[RBACKGROUND], false);
    
    // And now the planes
    // No priority:
    first = true;
    drawPlane((registers[RPLANEB_NT] & 0x07) << 13, false, dv); // B
    first = false;
    drawPlane((registers[RPLANEA_NT] & 0x38) << 10, false, dv); // A
    drawSprites(registers[RSPRITE_NT] << 9, false, dv); // Sprites
    // Window
    
    // Priority:
    drawPlane((registers[RPLANEB_NT] & 0x07) << 13, true, dv); // B
    drawPlane((registers[RPLANEA_NT] & 0x38) << 10, true, dv); // A
    drawSprites(registers[RSPRITE_NT] << 9, true, dv); // Sprites
    // Window
    
    return displayBuffer;
}

let drawPlane = function(start, priority, view) {
    for(let y = 0; y < prows; y ++) {
        for(let x = 0; x < pcols; x ++) {
            let cell = vram.getUint16(start, false);
            start += 2;
            if(((cell & 0x8000) == 0x8000) == priority) {
                // Priority is correct
                drawTile(cell, x * 8, y * 8, view);
            }
        }
    }
}

let drawSprites = function(start, priority, view) {
    while(start) {
        let vpos = vram.getUint16(start, false) & 0x01ff;
        let hpos = vram.getUint16(start + 6, false) & 0x00ff;
        let vsize = (vram.getUint16(start + 2, false) >> 8) & 0b11;
        let hsize = (vram.getUint16(start + 2, false) >> 10) & 0b11;
        let cell = (vram.getUint16(start + 4, false));
        
        if(((cell & 0x8000) == 0x8000) == priority) {
            // Priority is correct
            for(let cx = 0; cx <= hsize; cx ++) {
                for(let cy = 0; cy <= vsize; cy ++) {
                    drawTile(cell, hpos - 128 + (cx * 8), vpos - 128 + (cy * 8), view);
                    cell ++;
                }
            }
        }
        
        // Calculate link
        let link = vram.getUint16(start + 2, false) & 0x7f;
        if(link != 0) {
            start = (registers[RSPRITE_NT] << 9) + (link * 8);
        }else{
            start = 0;
        }
    }
}

// x and y are coordinates exactly
let drawTile = function(cell, x, y, view) {
    let pmask = (cell >>> 9) & 0x0030;
    let i = (cell & 0x7ff) << 5; // Is this right?
    let hi = true;
    let xbase = x;
    let ybase = y;
    
    for(let ys = 0; ys < 8; ys ++) {
        for(let xs = 0; xs < 8; xs ++) {
            let value;
            if(hi) {
                value = vram.getUint8(i) >>> 4;
            }else{
                value = vram.getUint8(i++) & 0x0f;
            }
            hi = !hi;
            
            // Check if in range
            if(xs + xbase >= width) continue;
            if(ys + ybase >= height) continue;
            if(xs + xbase < 0) continue;
            if(ys + ybase < 0) continue;
            
            let px = paletteRead(pmask | value, true);
            if(px) { // Check if not transparent
                // All good? Drop the pixel
                view.setUint32(((xs + xbase) + ((ys + ybase) * width)) * 4, px, false);
            }else if(first) {
                // Put a background pixel down
                view.setUint32(((xs + xbase) + ((ys + ybase) * width)) * 4, background, false);
            }
        }
    }
}
