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
const RH = 27;
const RV = 28;

const HSCROLL_ALL = 0b00;
const HSCROLL_TILE = 0b10;
const HSCROLL_SCANLINE = 0b11;

const VSCROLL_ALL = 0b0;
const VSCROLL_TILE = 0b1;

const A = 0;
const B = 1;
const S = 2;

let vram = null;
let cram = null;
let vsram = null;
let inited = false;
let registers = null;

let displayBuffer = null;
let composeBuffer = null;
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

let getVScroll = function(plane, col) {
    if(plane == S) return 0;
    
    switch((registers[RM3] >> 2) & 0b11) {
        case VSCROLL_ALL:
            return vsram.getInt16(plane * 2, false);
            
        case VSCROLL_TILE:
            return vsram.getInt16(~~(col / 8) * 4 + plane * 2, false);
        
        default:
            return 0;
    }
}

let getHScroll = function(plane, line) {
    // TODO: Each individual scanline has its own offest, not the whole tile
    if(plane == S) return 0;
    let base = registers[RHORSCROLL] << 10;
    
    switch(registers[RM3] & 0b11) {
        case HSCROLL_ALL:
            return vram.getInt16(base + (plane * 2), false);
            
        case HSCROLL_TILE:
            return vram.getInt16(base + (~~(line / 8) * 4) + (plane * 2), false);
        
        case HSCROLL_SCANLINE:
            return vram.getInt16(base + (line * 4) + (plane * 2), false);
        
        default:
            return 0;
    }
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

// Gets a pointer to a cell for a given x, y cell on the given plane
let getFromPlane = function(x, y, plane) {
    let base = 0;
    if(plane == A) {
        base = (registers[RPLANEA_NT] & 0x38) << 10;
    }else{
        base = (registers[RPLANEB_NT] & 0x07) << 13;
    }
    
    while(x >= pcols) x -= pcols;
    while(x < 0) x += pcols;
    
    while(y >= prows) y -= prows;
    while(y < 0) y += prows;
    
    let offset = ((y * pcols) + x) * 2;
    return base + offset;
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
let lblank; // Blank the leftmost 8 pixels (0 = off, 8 = on)

let doFrame = function() {
    // TODO: HV probably isn't 100% right
    registers[RV] = 0;
    registers[RH] = 0;
    
    rows = getDisplayRows();
    cols = getDisplayCols();
    prows = getPlaneRows();
    pcols = getPlaneCols();
    width = cols * 8;
    height = rows * 8;
    background = registers[RBACKGROUND] & 0x3f;
    let totalPx = (rows * 8) * (cols * 8);
    if(!displayBuffer || displayBuffer.byteLength != totalPx * 4) {
        if(displayBuffer) console.log("Recreating buffer " + displayBuffer.byteLength + " --> "+(totalPx * 4));
        displayBuffer = new ArrayBuffer(totalPx * 4);
        composeBuffer = new Uint8Array(totalPx);
    }
    lblank = (registers[RM1] & 0x20) != 0 ? 8 : 0;
    
    // COMPOSE
    // Create a buffer of palette entries
    
    // And now the planes
    // No priority:
    first = true;
    drawPlane((registers[RPLANEB_NT] & 0x07) << 13, false, composeBuffer, B); // B
    first = false;
    drawPlane((registers[RPLANEA_NT] & 0x38) << 10, false, composeBuffer, A); // A
    drawSprites(registers[RSPRITE_NT] << 9, false, composeBuffer); // Sprites
    // Window
    
    // Priority:
    drawPlane((registers[RPLANEB_NT] & 0x07) << 13, true, composeBuffer, B); // B
    drawPlane((registers[RPLANEA_NT] & 0x38) << 10, true, composeBuffer, A); // A
    drawSprites(registers[RSPRITE_NT] << 9, true, composeBuffer); // Sprites
    // Window
    
    // RENDER
    // Convert these palette entries to actual pixels
    render(composeBuffer, displayBuffer);
    
    registers[RH] = 0xff;
    registers[RV] = 0xff;
    
    return displayBuffer;
}

let drawPlane = function(start, priority, view, plane) {
    for(let y = 0; y < prows; y ++) {
        for(let x = 0; x < pcols; x ++) {
            let scrollx = -getHScroll(plane, y);
            let tx = scrollx >> 3;
            let txrem = (scrollx & 0b111) * -1;
            
            let scrolly = getVScroll(plane, x);
            let ty = scrolly >> 3;
            let tyrem = -(scrolly & 0b111);
            
            let cell = vram.getUint16(getFromPlane(x + tx, y + ty, plane), false);
            if(((cell & 0x8000) == 0x8000) == priority) {
                // Priority is correct
                drawTile(cell, x * 8 + txrem, y * 8 + tyrem, view, plane);
            }
        }
    }
}

let drawSprites = function(start, priority, view) {
    while(start) {
        let vpos = vram.getUint16(start, false) & 0x03ff;
        let hpos = vram.getUint16(start + 6, false) & 0x01ff;
        let vsize = (vram.getUint16(start + 2, false) >> 8) & 0b11;
        let hsize = (vram.getUint16(start + 2, false) >> 10) & 0b11;
        let cell = (vram.getUint16(start + 4, false));
        
        if(((cell & 0x8000) == 0x8000) == priority) {
            // Priority is correct
            for(let cx = 0; cx <= hsize; cx ++) {
                for(let cy = 0; cy <= vsize; cy ++) {
                    drawTile(cell, hpos - 128 + (cx * 8), vpos - 128 + (cy * 8), view, S);
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
let drawTile = function(cell, x, y, view, plane) {
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
            if(xs + xbase < lblank) continue;
            if(ys + ybase < 0) continue;
            
            let px = pmask | value;
            if(value) { // Check if not transparent
                // All good? Drop the pixel
                view[(xs + xbase) + ((ys + ybase) * width)] = px;
            }else if(first) {
                view[(xs + xbase) + ((ys + ybase) * width)] = background;
            }
        }
    }
}

let render = function(composeBuffer, displayBuffer) {
    let dv = new DataView(displayBuffer);
    for(let y = 0; y < height; y ++) {
        // V counter
        registers[RV] = (y > 0xea) ? (y - 5) : y;
        
        // H interrupt
        if(registers[RM1] & 0x10) {
            if(y % registers[RHORINT_C] == 0) {
                registers[REX] = 0x4;
            }
        }
        
        for(let x = 0; x < width; x ++) {
            registers[RH] = (x > 0xe9) ? (x - 0x56) : x;
            if(x > lblank) {
                let px = composeBuffer[(y * width) + x];
                let v = paletteRead(px & 0x3f, false);
                dv.setUint32(((y * width) + x) * 4, v, false);
            }else{
                dv.setUint32(((y * width) + x) * 4, paletteRead(background, false), false);
            }
        }
    }
}
