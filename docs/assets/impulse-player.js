(() => {
  window.initIndusTreeImpulsePlayer = function(options = {}) {
    if (window.__industreeImpulseStop) {
      try { window.__industreeImpulseStop(); } catch (_) {}
    }
    const mountId = options.mountId || 'impulsePlayerMount';
    if (!document.getElementById(mountId)) return;
    const impulseGeneration = (window.__industreeImpulseGeneration || 0) + 1;
    window.__industreeImpulseGeneration = impulseGeneration;
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FX = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const IT_FILES = (options.files || ['1-2sleepy.it']).map(file => typeof file === 'string' ? file : file.name);
const DEFAULT_IT_BASE_URL = 'https://audio.industree.org/itfiles/';
const IT_BASE_URL = (options.baseUrl || DEFAULT_IT_BASE_URL).replace(/\/?$/, '/');
const INITIAL_FILE = options.initialFile || IT_FILES[0];
const AUTOPLAY_INITIAL_FILE = Boolean(options.autoplay);
const onFileSelect = typeof options.onFileSelect === 'function' ? options.onFileSelect : null;
let currentItFile = INITIAL_FILE;

function noteStr(n) {
    if (n == null) return '...';
    if (n === 255) return '^^^';
    if (n === 254) return '===';
    if (n >= 0 && n <= 119) return NOTE_NAMES[n % 12] + (NOTE_NAMES[n % 12].length === 1 ? '-' : '') + Math.floor(n / 12);
    return '...';
}
function hex2(v) { return ('0' + (v || 0).toString(16)).slice(-2).toUpperCase(); }
function hex3(v) { return ('00' + (v || 0).toString(16)).slice(-3).toUpperCase(); }
function pad3(v) { return ('00' + v).slice(-3); }
function readStr(dv, off, len) { let s = ''; for (let i = 0; i < len; i++) { const c = dv.getUint8(off + i); if (!c) break; s += String.fromCharCode(c); } return s.trim(); }
function itFileUrl(name) { return IT_BASE_URL + encodeURIComponent(name); }
function itFileHash(name) { return '#/impulse/' + encodeURIComponent(name); }
function loadItFile(name, config) {
    const loadOptions = config || {};
    if (!name) return;
    currentItFile = name;
    updateFileListSelection();
    if (loadOptions.updateLocation && onFileSelect) onFileSelect(name);
    toast('Loading ' + name + '...');
    fetch(itFileUrl(name)).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(buf => {
            loadModule(buf);
            if (loadOptions.autoplay) startPlay(true);
        }).catch(err => toast('Failed: ' + name + ' (' + err.message + ')'));
}

// ── IT Parser ──────────────────────────────────────────────────
function parseIT(buf) {
    const dv = new DataView(buf);
    if (dv.byteLength < 0xC4) return null;
    const sig = readStr(dv, 0, 4);
    if (sig !== 'IMPM') return null;
    const songName = readStr(dv, 0x04, 26);
    const ordNum = dv.getUint16(0x20, true);
    const insNum = dv.getUint16(0x22, true);
    const smpNum = dv.getUint16(0x24, true);
    const patNum = dv.getUint16(0x26, true);
    const flags  = dv.getUint16(0x2C, true);
    const globalVol = dv.getUint8(0x30);
    const mixVol    = dv.getUint8(0x31);
    const speed     = dv.getUint8(0x32) || 6;
    const tempo     = dv.getUint8(0x33) || 125;
    const chnlPan = []; for (let i = 0; i < 64; i++) chnlPan.push(dv.getUint8(0x40 + i));
    const chnlVol = []; for (let i = 0; i < 64; i++) chnlVol.push(dv.getUint8(0x80 + i));
    const orders = []; for (let i = 0; i < ordNum; i++) orders.push(dv.getUint8(0xC0 + i));
    const insPtrBase = 0xC0 + ordNum;
    const smpPtrBase = insPtrBase + insNum * 4;
    const patPtrBase = smpPtrBase + smpNum * 4;
    const useInstruments = !!(flags & 4);

    const insOff = []; for (let i = 0; i < insNum; i++) insOff.push(dv.getUint32(insPtrBase + i * 4, true));
    const smpOff = []; for (let i = 0; i < smpNum; i++) smpOff.push(dv.getUint32(smpPtrBase + i * 4, true));
    const patOff = []; for (let i = 0; i < patNum; i++) patOff.push(dv.getUint32(patPtrBase + i * 4, true));

    const instruments = [];
    for (let i = 0; i < insNum; i++) {
        const o = insOff[i];
        if (!o || o + 0x130 > buf.byteLength || readStr(dv, o, 4) !== 'IMPI') { instruments.push({ name: '', sampleTable: [], volEnv: null, panEnv: null, pitchEnv: null }); continue; }
        const name = readStr(dv, o + 0x20, 26);
        const tbl = [];
        for (let k = 0; k < 120; k++) tbl.push({ note: dv.getUint8(o + 0x40 + k * 2), smp: dv.getUint8(o + 0x40 + k * 2 + 1) });
        const volEnv = parseEnvelope(dv, o + 0x130);
        const panEnv = parseEnvelope(dv, o + 0x182);
        const pitchEnv = parseEnvelope(dv, o + 0x1D4);
        instruments.push({ name, sampleTable: tbl, volEnv, panEnv, pitchEnv });
    }

    const samples = [];
    for (let i = 0; i < smpNum; i++) {
        const o = smpOff[i];
        if (!o || o + 0x50 > buf.byteLength || readStr(dv, o, 4) !== 'IMPS') {
            samples.push({ name: '', length: 0, data: null, c5speed: 8363, vol: 64, loopStart: 0, loopEnd: 0, loop: false, bits16: false, flags: 0 });
            continue;
        }
        const sFlags = dv.getUint8(o + 0x12);
        const vol    = dv.getUint8(o + 0x13);
        const name   = readStr(dv, o + 0x14, 26);
        const cvt    = dv.getUint8(o + 0x20);
        const length    = dv.getUint32(o + 0x30, true);
        const loopStart = dv.getUint32(o + 0x34, true);
        const loopEnd   = dv.getUint32(o + 0x38, true);
        const c5speed   = dv.getUint32(o + 0x3C, true) || 8363;
        const susLoopStart = dv.getUint32(o + 0x40, true);
        const susLoopEnd   = dv.getUint32(o + 0x44, true);
        const dataOff      = dv.getUint32(o + 0x48, true);
        const bits16     = !!(sFlags & 2);
        const compressed = !!(sFlags & 8);
        const loop       = !!(sFlags & 16);
        const susLoop    = !!(sFlags & 32);
        const pingPong   = !!(sFlags & 64);
        const signed     = !!(cvt & 1);
        let data = null;
        if (length > 0 && dataOff > 0 && dataOff < buf.byteLength) {
            try {
                data = compressed ? decompressIT(dv, dataOff, length, bits16) : readRaw(dv, dataOff, length, bits16, signed);
            } catch (e) { console.warn('Sample', i, 'load error:', e); }
        }
        samples.push({ name, length, data, c5speed, vol: vol || 64, loopStart, loopEnd, loop, pingPong, susLoop, susLoopStart, susLoopEnd, bits16, flags: sFlags });
    }

    const patterns = [];
    for (let p = 0; p < patNum; p++) {
        const o = patOff[p];
        if (!o) { patterns.push(emptyPat(64)); continue; }
        try {
            const packLen = dv.getUint16(o, true);
            const rows = dv.getUint16(o + 2, true) || 64;
            const start = o + 8;
            const len = Math.min(packLen, buf.byteLength - start);
            if (len <= 0) { patterns.push(emptyPat(rows)); continue; }
            patterns.push({ rows, data: unpackPat(new Uint8Array(buf, start, len), rows) });
        } catch (e) { console.warn('Pattern', p, 'error:', e); patterns.push(emptyPat(64)); }
    }

    console.log('Parsed IT:', songName, '| ord:', ordNum, '| ins:', insNum, '| smp:', smpNum, '| pat:', patNum, '| spd:', speed, '| tmp:', tempo);
    return { songName, orders, instruments, samples, patterns, speed, tempo, globalVol, mixVol, flags, useInstruments, chnlPan, chnlVol };
}

function parseEnvelope(dv, off) {
    try {
        const flg = dv.getUint8(off);
        const num = dv.getUint8(off + 1);
        const lpB = dv.getUint8(off + 2);
        const lpE = dv.getUint8(off + 3);
        const slB = dv.getUint8(off + 4);
        const slE = dv.getUint8(off + 5);
        const nodes = [];
        for (let i = 0; i < Math.min(num, 25); i++) {
            const y = dv.getInt8(off + 6 + i * 3);
            const x = dv.getUint16(off + 7 + i * 3, true);
            nodes.push({ x, y });
        }
        return { enabled: !!(flg & 1), loop: !!(flg & 2), susLoop: !!(flg & 4), lpB, lpE, slB, slE, nodes };
    } catch (e) { return null; }
}

function emptyPat(rows) {
    const data = [];
    for (let r = 0; r < rows; r++) { const row = []; for (let c = 0; c < 64; c++) row.push({ note: null, inst: null, vol: null, eff: 0, param: 0 }); data.push(row); }
    return { rows, data };
}

function readRaw(dv, off, len, b16, signed) {
    const bLen = dv.byteLength;
    const avail = Math.min(len, Math.floor((bLen - off) / (b16 ? 2 : 1)));
    if (avail <= 0) return null;
    const out = new Float32Array(avail);
    if (b16) {
        if (signed) { for (let i = 0; i < avail; i++) { const p = off + i * 2; if (p + 1 >= bLen) break; out[i] = dv.getInt16(p, true) / 32768; } }
        else { for (let i = 0; i < avail; i++) { const p = off + i * 2; if (p + 1 >= bLen) break; out[i] = (dv.getUint16(p, true) - 32768) / 32768; } }
    } else {
        if (signed) { for (let i = 0; i < avail; i++) { const p = off + i; if (p >= bLen) break; let r = dv.getUint8(p); out[i] = (r > 127 ? r - 256 : r) / 128; } }
        else { for (let i = 0; i < avail; i++) { const p = off + i; if (p >= bLen) break; out[i] = (dv.getUint8(p) - 128) / 128; } }
    }
    return out;
}

// Ported from Schism Tracker fmt/compression.c
function decompressIT(dv, dataOff, length, b16) {
    const BLOCK = b16 ? 0x4000 : 0x8000;
    const maxW = b16 ? 17 : 9;
    const topBit = b16 ? 0x10000 : 0x100;
    const norm = b16 ? 32768 : 128;
    const out = new Float32Array(length);
    let outPos = 0, fp = dataOff;
    while (outPos < length) {
        if (fp + 2 > dv.buffer.byteLength) break;
        const blockBytes = dv.getUint16(fp, true); fp += 2;
        const blockEnd = Math.min(fp + blockBytes, dv.buffer.byteLength);
        if (!blockBytes) { outPos += BLOCK; continue; }
        const blkLen = Math.min(BLOCK, length - outPos);
        let sPos = fp, bBuf = 0, bNum = 0;
        function rb(n) {
            let val = 0, i = n;
            while (i--) {
                if (!bNum) { if (sPos >= blockEnd) return -1; bBuf = dv.getUint8(sPos++); bNum = 8; }
                val >>>= 1; val |= (bBuf & 1) << 31; bBuf >>>= 1; bNum--;
            }
            return val >>> (32 - n);
        }
        let width = maxW, d1 = 0, blkPos = 0;
        while (blkPos < blkLen) {
            if (width > maxW) break;
            const value = rb(width);
            if (value < 0) break;
            if (width < 7) {
                if (value === (1 << (width - 1))) {
                    const nv = rb(b16 ? 4 : 3); if (nv < 0) break;
                    const nw = nv + 1;
                    width = (nw < width) ? nw : nw + 1;
                    continue;
                }
            } else if (width < maxW) {
                const border = ((b16 ? 0xFFFF : 0xFF) >>> (maxW - width)) - (b16 ? 8 : 4);
                if (value > border && value <= border + (b16 ? 16 : 8)) {
                    const nw = value - border;
                    width = (nw < width) ? nw : nw + 1;
                    continue;
                }
            } else {
                if (value & topBit) { width = (value + 1) & 0xFF; continue; }
            }
            let v;
            if (b16) {
                if (width < 16) { v = (value << (16 - width)) << 16 >> 16 >> (16 - width); }
                else v = value << 16 >> 16;
            } else {
                if (width < 8) { v = (value << (8 - width)) << 24 >> 24 >> (8 - width); }
                else v = value << 24 >> 24;
            }
            d1 = b16 ? (d1 + v) << 16 >> 16 : (d1 + v) << 24 >> 24;
            out[outPos++] = d1 / norm;
            blkPos++;
        }
        fp += blockBytes;
    }
    return out;
}

function unpackPat(pd, numRows) {
    const data = [];
    for (let r = 0; r < numRows; r++) { const row = []; for (let c = 0; c < 64; c++) row.push({ note: null, inst: null, vol: null, eff: 0, param: 0 }); data.push(row); }
    const last = []; for (let c = 0; c < 64; c++) last.push({ note: null, inst: null, vol: null, eff: 0, param: 0, mask: 0 });
    let p = 0, row = 0;
    while (row < numRows && p < pd.length) {
        const cb = pd[p++];
        if (!cb) { row++; continue; }
        const ch = (cb - 1) & 63;
        let mask = (cb & 128) ? pd[p++] : last[ch].mask;
        last[ch].mask = mask;
        if (mask & 1) last[ch].note = pd[p++];
        if (mask & 2) last[ch].inst = pd[p++];
        if (mask & 4) last[ch].vol = pd[p++];
        if (mask & 8) { last[ch].eff = pd[p++]; last[ch].param = pd[p++]; }
        data[row][ch] = { note: last[ch].note, inst: last[ch].inst, vol: last[ch].vol, eff: last[ch].eff || 0, param: last[ch].param || 0 };
    }
    return data;
}

// ── Playback Engine ────────────────────────────────────────────
function makeChn() {
    return { src: null, gain: null, filter: null, note: -1, inst: 0, vol: 64, smpVol: 64, chnVol: 64,
             period: 0, active: false,
             envVol: { tick: 0, val: 64, nodeIdx: 0, fadeout: 1024, released: false },
             envPitch: { tick: 0, val: 0, nodeIdx: 0 },
             envPan: { tick: 0, val: 0, nodeIdx: 0 },
             cutoff: 127, resonance: 0,
             volSlide: 0, lastDxx: 0, tempoSlide: 0 };
}
const state = {
    mod: null, ctx: null, master: null,
    playing: false, ordIdx: 0, row: 0, tick: 0, speed: 6, tempo: 125,
    schedTime: 0, animId: null, playStartTime: 0,
    displayRow: 0, displayOrd: 0, lastDisplayRow: -1, lastDisplayOrd: -1,
    channels: new Array(64).fill(null).map(makeChn),
    selectedSmp: 0, selectedIns: 0, selectedEnvType: 'vol',
    toastId: null, pianoOctave: 4, pianoKeys: {},
    editCursorRow: 0, editCursorCh: 0, editCursorField: 0, editMode: false,
    selectedOrdIdx: 0, patternLoop: false,
};

function tickLen() { return 2.5 / state.tempo; }

function sampleForNote(mod, instNum, note) {
    if (mod.useInstruments && instNum >= 1 && instNum <= mod.instruments.length) {
        const ins = mod.instruments[instNum - 1];
        if (ins.sampleTable && note >= 0 && note <= 119) {
            const p = ins.sampleTable[note];
            if (p && p.smp >= 1 && p.smp <= mod.samples.length) return { smp: mod.samples[p.smp - 1], note: p.note };
        }
    }
    if (!mod.useInstruments && instNum >= 1 && instNum <= mod.samples.length) return { smp: mod.samples[instNum - 1], note };
    return null;
}

function buildAudioBuffer(smp) {
    if (smp._abuf) return smp._abuf;
    if (!smp.data || !smp.data.length) return null;
    const rate = smp.c5speed || 44100;
    if (smp.loop && smp.pingPong && smp.loopEnd > smp.loopStart) {
        const ls = Math.min(smp.loopStart, smp.data.length);
        const le = Math.min(smp.loopEnd, smp.data.length);
        const loopLen = le - ls;
        const newLen = le + loopLen;
        const ab = state.ctx.createBuffer(1, newLen, rate);
        const ch = ab.getChannelData(0);
        for (let i = 0; i < le; i++) ch[i] = smp.data[i];
        for (let i = 0; i < loopLen; i++) ch[le + i] = smp.data[le - 1 - i];
        smp._abuf = ab;
        smp._ppLoopStart = ls / rate;
        smp._ppLoopEnd = (le + loopLen) / rate;
        return ab;
    }
    const ab = state.ctx.createBuffer(1, smp.data.length, rate);
    ab.getChannelData(0).set(smp.data);
    smp._abuf = ab;
    smp._ppLoopStart = null;
    smp._ppLoopEnd = null;
    return ab;
}

function evalEnvelope(env, envState, isVol) {
    if (!env || !env.enabled || !env.nodes || env.nodes.length < 2) return isVol ? 64 : 0;
    const nodes = env.nodes;
    const tick = envState.tick;
    let idx = envState.nodeIdx;
    if (idx >= nodes.length - 1) idx = nodes.length - 2;
    while (idx < nodes.length - 2 && tick >= nodes[idx + 1].x) idx++;
    while (idx > 0 && tick < nodes[idx].x) idx--;
    envState.nodeIdx = idx;
    const n0 = nodes[idx], n1 = nodes[Math.min(idx + 1, nodes.length - 1)];
    let val;
    if (n0.x === n1.x) { val = n1.y; }
    else { const t = (tick - n0.x) / (n1.x - n0.x); val = n0.y + (n1.y - n0.y) * t; }
    envState.val = val;
    if (env.susLoop && !envState.released && envState.tick >= nodes[env.slE].x) {
        envState.tick = nodes[env.slB].x;
        envState.nodeIdx = env.slB;
    } else if (env.loop && envState.tick >= nodes[env.lpE].x) {
        envState.tick = nodes[env.lpB].x;
        envState.nodeIdx = env.lpB;
    } else if (envState.tick < nodes[nodes.length - 1].x) {
        envState.tick++;
    }
    return val;
}

function cutoffToFreq(cutoff) {
    return 131.0 * Math.pow(2, cutoff * (10.0 / 127.0));
}

function computeVol(chn, mod, smpVol) {
    const vol = chn.vol / 64;
    const sv = (smpVol || 64) / 64;
    const cv = (chn.chnVol != null ? chn.chnVol : 64) / 64;
    const gv = mod.globalVol / 128;
    const mv = mod.mixVol / 128;
    return vol * sv * cv * gv * mv;
}

function triggerNote(ch, note, instNum, when) {
    const mod = state.mod;
    if (!mod || !state.ctx || !state.master) return;
    const chn = state.channels[ch];
    if (note === 254) {
        if (chn.src) try { chn.src.stop(when || 0); } catch (_) {}
        chn.active = false; return;
    }
    if (note === 255) {
        chn.envVol.released = true;
        chn.envPitch.released = true;
        if (chn.gain && when) {
            chn.gain.gain.setValueAtTime(chn.gain.gain.value, when);
            chn.gain.gain.linearRampToValueAtTime(0, when + 0.03);
            if (chn.src) try { chn.src.stop(when + 0.04); } catch (_) {}
        } else if (chn.src) { try { chn.src.stop(); } catch (_) {} }
        chn.active = false; return;
    }
    if (chn.src) try { chn.src.stop(when || 0); } catch (_) {}
    chn.active = false;
    const res = sampleForNote(mod, instNum, note);
    if (!res || !res.smp || !res.smp.data) return;
    const smp = res.smp;
    chn.smpVol = smp.vol;
    chn.vol = smp.vol;
    const ab = buildAudioBuffer(smp);
    if (!ab) return;
    try {
        const rate = smp.c5speed || 44100;
        const src = state.ctx.createBufferSource();
        src.buffer = ab;
        if (smp.loop && smp.loopEnd > smp.loopStart) {
            src.loop = true;
            if (smp._ppLoopStart != null) { src.loopStart = smp._ppLoopStart; src.loopEnd = smp._ppLoopEnd; }
            else { src.loopStart = smp.loopStart / rate; src.loopEnd = smp.loopEnd / rate; }
        }
        const g = state.ctx.createGain();
        g.gain.value = computeVol(chn, mod, smp.vol);
        const flt = state.ctx.createBiquadFilter();
        flt.type = 'lowpass';
        flt.frequency.value = cutoffToFreq(chn.cutoff);
        flt.Q.value = 1.0 + chn.resonance * 0.15;
        src.connect(flt); flt.connect(g); g.connect(state.master);
        src.playbackRate.value = Math.pow(2, (note - 60) / 12);
        src.start(when || 0);
        chn.src = src; chn.gain = g; chn.filter = flt;
        chn.note = note; chn.inst = instNum; chn.active = true;
        chn.envVol = { tick: 0, val: 64, nodeIdx: 0, fadeout: 1024, released: false };
        chn.envPitch = { tick: 0, val: 0, nodeIdx: 0, released: false };
        chn.envPan = { tick: 0, val: 0, nodeIdx: 0, released: false };
    } catch (e) { console.warn('triggerNote', e); }
}

function updateEnvelopes(when) {
    const mod = state.mod;
    if (!mod || !mod.useInstruments) return;
    for (let ch = 0; ch < 64; ch++) {
        const chn = state.channels[ch];
        if (!chn.active || chn.inst < 1 || chn.inst > mod.instruments.length) continue;
        const ins = mod.instruments[chn.inst - 1];
        const t = when || state.ctx.currentTime;
        if (ins.volEnv && ins.volEnv.enabled) {
            const vev = evalEnvelope(ins.volEnv, chn.envVol, true);
            const volScale = Math.max(0, vev) / 64;
            if (chn.gain) {
                const baseVol = computeVol(chn, mod, chn.smpVol);
                chn.gain.gain.setValueAtTime(baseVol * volScale * (chn.envVol.fadeout / 1024), t);
            }
            if (chn.envVol.released && ins.volEnv.nodes) {
                chn.envVol.fadeout = Math.max(0, chn.envVol.fadeout - 32);
                if (chn.envVol.fadeout <= 0 && chn.src) {
                    try { chn.src.stop(t + 0.01); } catch (_) {}
                    chn.active = false;
                }
            }
        }
        if (ins.pitchEnv && ins.pitchEnv.enabled) {
            const pev = evalEnvelope(ins.pitchEnv, chn.envPitch, false);
            const semitones = pev / 2.0;
            if (chn.src) {
                const baseRate = Math.pow(2, (chn.note - 60) / 12);
                chn.src.playbackRate.setValueAtTime(baseRate * Math.pow(2, semitones / 12), t);
            }
        }
    }
}

function applyVolColumn(chn, v, when, mod) {
    if (v <= 64) {
        chn.vol = v;
    } else if (v >= 65 && v <= 74) { // fine vol up
        chn.vol = Math.min(64, chn.vol + (v - 65));
    } else if (v >= 75 && v <= 84) { // fine vol down
        chn.vol = Math.max(0, chn.vol - (v - 75));
    } else if (v >= 85 && v <= 94) { // vol slide up (per tick)
        chn.volSlide = (v - 85);
    } else if (v >= 95 && v <= 104) { // vol slide down (per tick)
        chn.volSlide = -(v - 95);
    }
    // 105-124: pitch slide (not implemented yet)
    // 128-192: panning
    if (chn.gain && v <= 64) {
        chn.gain.gain.setValueAtTime(computeVol(chn, mod, chn.smpVol), when || state.ctx.currentTime);
    }
}

function processRow(when) {
    const mod = state.mod;
    if (!mod) return;
    let patIdx = mod.orders[state.ordIdx];
    while (patIdx === 254) { state.ordIdx++; if (state.ordIdx >= mod.orders.length) { state.ordIdx = 0; } patIdx = mod.orders[state.ordIdx]; }
    if (patIdx === 255) { state.playing = false; return; }
    const pat = mod.patterns[patIdx];
    if (!pat || !pat.data || state.row >= pat.rows) {
        state.row = 0;
        if (!state.patternLoop) { state.ordIdx++; if (state.ordIdx >= mod.orders.length) state.ordIdx = 0; }
        return;
    }
    const rowData = pat.data[state.row];
    let newOrd = -1, newRow = -1;
    for (let ch = 0; ch < 64; ch++) {
        const cell = rowData[ch];
        const chn = state.channels[ch];
        chn.volSlide = 0;
        chn.tempoSlide = 0;

        if (cell.note != null && cell.inst != null && cell.inst > 0) {
            triggerNote(ch, cell.note, cell.inst, when);
        } else if (cell.note != null && cell.note <= 119) {
            triggerNote(ch, cell.note, chn.inst || 1, when);
        } else if (cell.note === 255 || cell.note === 254) {
            triggerNote(ch, cell.note, 0, when);
        } else if (cell.inst > 0 && !cell.note) {
            // Instrument change without note: reset volume to sample default
            const res = sampleForNote(mod, cell.inst, chn.note >= 0 ? chn.note : 60);
            if (res && res.smp) { chn.smpVol = res.smp.vol; chn.vol = res.smp.vol; }
        }

        if (cell.inst > 0) chn.inst = cell.inst;

        // Volume column applied after note trigger so it overrides the sample default
        if (cell.vol != null) applyVolColumn(chn, cell.vol, when, mod);

        // Axx = set speed (ticks per row; xx=0 no-op)
        if (cell.eff === 1 && cell.param) state.speed = Math.max(1, Math.min(255, cell.param));
        // Bxx = jump to order
        if (cell.eff === 2) newOrd = cell.param;
        // Cxx = break to row
        if (cell.eff === 3) newRow = cell.param;

        // Dxx = volume slide
        if (cell.eff === 4) {
            const p = cell.param || chn.lastDxx;
            if (p) chn.lastDxx = p;
            const hi = (p >> 4) & 0xF, lo = p & 0xF;
            if (hi === 0xF && lo) { chn.vol = Math.max(0, chn.vol - lo); } // DFx: fine slide down
            else if (lo === 0xF && hi) { chn.vol = Math.min(64, chn.vol + hi); } // DxF: fine slide up
            else if (hi && !lo) { chn.volSlide = hi; } // Dx0: slide up per tick
            else if (lo && !hi) { chn.volSlide = -lo; } // D0x: slide down per tick
            if (chn.gain) chn.gain.gain.setValueAtTime(computeVol(chn, mod, chn.smpVol), when || state.ctx.currentTime);
        }

        // Mxx = set channel volume
        if (cell.eff === 13) {
            chn.chnVol = Math.min(64, cell.param);
            if (chn.gain) chn.gain.gain.setValueAtTime(computeVol(chn, mod, chn.smpVol), when || state.ctx.currentTime);
        }

        // Nxx = channel volume slide
        if (cell.eff === 14) {
            const hi = (cell.param >> 4) & 0xF, lo = cell.param & 0xF;
            if (hi === 0xF && lo) { chn.chnVol = Math.max(0, chn.chnVol - lo); }
            else if (lo === 0xF && hi) { chn.chnVol = Math.min(64, chn.chnVol + hi); }
            if (chn.gain) chn.gain.gain.setValueAtTime(computeVol(chn, mod, chn.smpVol), when || state.ctx.currentTime);
        }

        // Txx = tempo (BPM): xx>=0x20 set tempo, T1x slide up, T0x slide down
        if (cell.eff === 20) {
            const p = cell.param;
            if (p >= 0x20) {
                state.tempo = Math.max(32, Math.min(255, p));
            } else if (p >= 0x10) {
                chn.tempoSlide = p & 0x0F; // T1x: slide up per tick
            } else if (p >= 0x01) {
                chn.tempoSlide = -(p & 0x0F); // T0x: slide down per tick
            }
        }

        // Vxx = set global volume
        if (cell.eff === 22 && cell.param <= 128) {
            mod.globalVol = cell.param;
        }

        // Zxx = MIDI macro; we implement filter: 80-FF = cutoff, 00-7F = resonance
        if (cell.eff === 26) {
            const p = cell.param;
            if (p >= 0x80) {
                chn.cutoff = Math.min(127, p - 0x80);
                if (chn.filter) chn.filter.frequency.setValueAtTime(cutoffToFreq(chn.cutoff), when || state.ctx.currentTime);
            } else {
                chn.resonance = p;
                if (chn.filter) chn.filter.Q.setValueAtTime(1.0 + chn.resonance * 0.15, when || state.ctx.currentTime);
            }
        }
    }
    if (newOrd >= 0 && !state.patternLoop) { state.ordIdx = newOrd; state.row = 0; return; }
    if (newRow >= 0) {
        if (state.patternLoop) { state.row = newRow; }
        else { state.ordIdx++; if (state.ordIdx >= mod.orders.length) state.ordIdx = 0; state.row = newRow; }
        return;
    }
    state.row++;
    if (state.row >= pat.rows) {
        state.row = 0;
        if (!state.patternLoop) { state.ordIdx++; if (state.ordIdx >= mod.orders.length) state.ordIdx = 0; }
    }
}

function processTickEffects(when) {
    const mod = state.mod;
    if (!mod) return;
    for (let ch = 0; ch < 64; ch++) {
        const chn = state.channels[ch];
        if (chn.volSlide) {
            chn.vol = Math.max(0, Math.min(64, chn.vol + chn.volSlide));
            if (chn.gain) chn.gain.gain.setValueAtTime(computeVol(chn, mod, chn.smpVol), when || state.ctx.currentTime);
        }
        if (chn.tempoSlide) {
            state.tempo = Math.max(32, Math.min(255, state.tempo + chn.tempoSlide));
        }
    }
}

function scheduler() {
    if (!state.mod || !state.playing) return;
    const LOOKAHEAD = 0.1;
    while (state.schedTime < state.ctx.currentTime + LOOKAHEAD) {
        state.tick++;
        if (state.tick >= state.speed) {
            state.tick = 0;
            const rowBefore = state.row, ordBefore = state.ordIdx;
            processRow(state.schedTime);
            state.displayRow = rowBefore;
            state.displayOrd = ordBefore;
        } else {
            processTickEffects(state.schedTime);
        }
        updateEnvelopes(state.schedTime);
        state.schedTime += tickLen();
        if (!state.playing) break;
    }
}

function loop() {
    scheduler();
    if (state.displayRow !== state.lastDisplayRow || state.displayOrd !== state.lastDisplayOrd) {
        state.lastDisplayRow = state.displayRow;
        state.lastDisplayOrd = state.displayOrd;
        state.row = state.displayRow;
        state.ordIdx = state.displayOrd;
        updateUI();
    }
    if (state.playing) state.animId = requestAnimationFrame(loop);
}

// ── Audio Init ─────────────────────────────────────────────────
function initAudio() {
    if (state.ctx) return state.ctx.resume();
    state.ctx = new (window.AudioContext || window.webkitAudioContext)();
    state.master = state.ctx.createGain();
    state.master.gain.value = 0.7;
    state.master.connect(state.ctx.destination);
    return Promise.resolve();
}

// ── UI ─────────────────────────────────────────────────────────
function loadModule(buf, skipSave) {
    const mod = parseIT(buf);
    if (!mod) { toast('Not a valid IT file'); return; }
    stopPlayback();
    state.mod = mod; state.speed = mod.speed; state.tempo = mod.tempo; state.ordIdx = 0; state.row = 0; state.tick = 0;
    state.channels = new Array(64).fill(null).map(makeChn);
    for (let i = 0; i < 64; i++) {
        state.channels[i].chnVol = mod.chnlVol[i] || 64;
    }
    state.editCursorRow = 0; state.editCursorCh = 0;
    document.getElementById('btnPlay').disabled = false;
    document.getElementById('btnStop').disabled = false;
    document.getElementById('btnNewPat').disabled = false;
    state.selectedSmp = 0; state.selectedIns = 0;
    buildSampleList(); buildInstrumentList(); updateUI();
    toast('Loaded: ' + (mod.songName || 'module') + ' (' + mod.samples.length + ' smp, ' + mod.patterns.length + ' pat)');
    if (!skipSave) saveToStorage(buf);
}

function saveToStorage(buf) {
    try {
        const bytes = new Uint8Array(buf);
        const CHUNK = 8192;
        let b64 = '';
        for (let i = 0; i < bytes.length; i += CHUNK) b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        b64 = btoa(b64);
        localStorage.setItem('impulse0_file', b64);
        localStorage.setItem('impulse0_name', state.mod ? state.mod.songName : '');
    } catch (e) { console.warn('localStorage save failed:', e); }
}

function loadFromStorage() {
    try {
        const b64 = localStorage.getItem('impulse0_file');
        if (!b64) return false;
        const bin = atob(b64);
        const buf = new ArrayBuffer(bin.length);
        const view = new Uint8Array(buf);
        for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
        loadModule(buf, true);
        return true;
    } catch (e) { console.warn('localStorage load failed:', e); return false; }
}

function stopPlayback() {
    state.playing = false;
    if (state.animId) { cancelAnimationFrame(state.animId); state.animId = null; }
    state.channels.forEach(c => {
        if (c.src) try { c.src.stop(); } catch (_) {}
        c.src = null; c.gain = null; c.filter = null; c.active = false;
    });
}

function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.style.display = 'block';
    clearTimeout(state.toastId); state.toastId = setTimeout(() => el.style.display = 'none', 3000);
}

function updateInfoHeader() {
    const mod = state.mod;
    document.getElementById('ihSongName').textContent = mod ? (mod.songName || '(unnamed)') : 'No module loaded';
    if (!mod) return;
    const patIdx = mod.orders[state.ordIdx];
    const pat = (patIdx != null && patIdx < mod.patterns.length) ? mod.patterns[patIdx] : null;
    document.getElementById('ihOrder').textContent = hex2(state.ordIdx) + '/' + hex2(mod.orders.length);
    document.getElementById('ihPattern').textContent = patIdx != null ? hex2(patIdx) : '---';
    document.getElementById('ihRow').textContent = hex2(state.row) + '/' + (pat ? hex2(pat.rows) : '---');
    document.getElementById('ihChannels').textContent = '64';
    document.getElementById('ihInst').textContent = hex2(state.selectedIns + 1);
    document.getElementById('ihOctave').textContent = state.pianoOctave;
    document.getElementById('inputSpeed').value = state.speed;
    document.getElementById('inputTempo').value = state.tempo;
    document.getElementById('ihSmpCount').textContent = mod.samples.length;
    document.getElementById('ihInsCount').textContent = mod.instruments.length;
    if (state.playing && state.ctx) {
        const elapsed = state.ctx.currentTime - state.playStartTime;
        const m = Math.floor(elapsed / 60);
        const s = Math.floor(elapsed % 60);
        const ms = Math.floor((elapsed * 100) % 100);
        document.getElementById('ihTime').textContent = m + ':' + ('0' + s).slice(-2) + ':' + ('0' + ms).slice(-2);
    }
}

function updateUI() {
    const mod = state.mod; if (!mod) return;
    updateInfoHeader();
    renderOrderBar();
    const patIdx = mod.orders[state.ordIdx];
    renderPattern(patIdx);
    if (isOnPanel('orderPanel')) renderOrderEditor();
}

function renderOrderBar() {
    const bar = document.getElementById('orderBar');
    const mod = state.mod;
    if (!mod) { bar.innerHTML = '<span class="lbl">Order:</span>'; return; }
    const cells = mod.orders.map((pat, i) => {
        let cls = 'ord-cell';
        if (i === state.ordIdx) cls += ' current';
        if (pat === 254) cls += ' skip';
        if (pat === 255) cls += ' end';
        const label = pat === 255 ? '---' : pat === 254 ? '+++' : hex2(pat);
        return '<span class="' + cls + '" data-ord="' + i + '">' + label + '</span>';
    }).join('');
    bar.innerHTML = '<span class="lbl">Order:</span>' + cells;
    bar.querySelectorAll('.ord-cell').forEach(el => {
        el.onclick = () => {
            state.ordIdx = parseInt(el.dataset.ord);
            state.row = 0; updateUI();
        };
    });
    const cur = bar.querySelector('.ord-cell.current');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
}

function renderPattern(patIdx) {
    const mod = state.mod;
    const thead = document.getElementById('patHead');
    const tbody = document.getElementById('patBody');
    thead.innerHTML = ''; tbody.innerHTML = '';
    if (!mod || patIdx == null || patIdx >= mod.patterns.length) return;
    const pat = mod.patterns[patIdx];
    if (!pat || !pat.data || !pat.data.length) return;
    let usedCh = 0;
    for (let c = 63; c >= 0; c--) { for (let r = 0; r < pat.rows; r++) { const cl = pat.data[r][c]; if (cl.note != null || cl.inst != null || cl.vol != null || cl.eff) { usedCh = c + 1; break; } } if (usedCh) break; }
    usedCh = Math.max(usedCh, 4);
    let h = '<tr><th class="rn">Row</th>';
    for (let c = 0; c < usedCh; c++) h += '<th>Chnl ' + ('0' + (c + 1)).slice(-2) + '</th>';
    h += '</tr>'; thead.innerHTML = h;
    const frag = document.createDocumentFragment();
    for (let r = 0; r < pat.rows; r++) {
        const tr = document.createElement('tr');
        if (r === state.row && state.playing) tr.className = 'play';
        else if (r === state.editCursorRow && !state.playing) tr.className = 'cur';
        let html = '<td class="rn">' + hex2(r) + '</td>';
        for (let c = 0; c < usedCh; c++) {
            const cl = pat.data[r][c];
            const isEmpty = cl.note == null && cl.inst == null && cl.vol == null && !cl.eff;
            const ns = noteStr(cl.note);
            const nc = (cl.note === 255 || cl.note === 254) ? 'nt off' : 'nt';
            const is = cl.inst != null ? hex2(cl.inst) : '..';
            const vs = cl.vol != null ? hex2(cl.vol) : '..';
            const ef = cl.eff ? FX[cl.eff] : '.';
            const ep = hex2(cl.param);
            const selCls = (r === state.editCursorRow && c === state.editCursorCh && !state.playing) ? ' sel' : '';
            html += '<td class="c' + (isEmpty ? ' empty' : '') + selCls + '" data-r="' + r + '" data-c="' + c +
                '"><span class="' + nc + '">' + ns + '</span> <span class="in">' + is +
                '</span> <span class="vl">' + vs + '</span> <span class="fx">' + ef + ep + '</span></td>';
        }
        tr.innerHTML = html;
        frag.appendChild(tr);
    }
    tbody.appendChild(frag);

    tbody.querySelectorAll('td.c').forEach(td => {
        td.onclick = () => {
            state.editCursorRow = parseInt(td.dataset.r);
            state.editCursorCh = parseInt(td.dataset.c);
            updateUI();
        };
    });

    const wrap = document.getElementById('patternWrap');
    if (state.playing) {
        const rowEl = tbody.querySelector('tr.play');
        if (rowEl) rowEl.scrollIntoView({ block: 'center', behavior: 'auto' });
    } else {
        const rowEl = tbody.querySelector('tr.cur');
        if (rowEl) rowEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
}

// ── Sample Editor ──────────────────────────────────────────────
function buildSampleList() {
    const mod = state.mod; if (!mod) return;
    const el = document.getElementById('smpList');
    el.innerHTML = '';
    mod.samples.forEach((s, i) => {
        const d = document.createElement('div');
        d.className = 'smp-item' + (i === state.selectedSmp ? ' active' : '');
        d.innerHTML = '<span class="idx">' + hex2(i + 1) + '</span><span>' + (s.name || '(empty)') + '</span>';
        d.onclick = () => { state.selectedSmp = i; buildSampleList(); renderSample(); };
        el.appendChild(d);
    });
    renderSample();
}

function renderSample() {
    const mod = state.mod; if (!mod) return;
    const smp = mod.samples[state.selectedSmp];
    if (!smp) return;
    document.getElementById('smpInfo').innerHTML = [
        field('Name', smp.name || '(none)'), field('Length', smp.length),
        field('C5 Speed', smp.c5speed + ' Hz'), field('Volume', smp.vol),
        field('Bits', smp.bits16 ? '16' : '8'),
        field('Loop', smp.loop ? smp.loopStart + '→' + smp.loopEnd + (smp.pingPong ? ' PP' : '') : 'Off'),
        field('Sus Loop', smp.susLoop ? smp.susLoopStart + '→' + smp.susLoopEnd : 'Off'),
        field('Data', smp.data ? 'Yes (' + smp.data.length + ')' : 'No'),
    ].join('');
    drawWaveform(smp);
}

function field(lbl, val) { return '<div class="field"><span class="lbl">' + lbl + ':</span><span class="val">' + val + '</span></div>'; }

function drawWaveform(smp) {
    const canvas = document.getElementById('waveCanvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1);
    const h = canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
    ctx.fillStyle = '#050510'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1a1a2e'; ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    if (!smp.data || !smp.data.length) { ctx.fillStyle = '#333'; ctx.font = '12px monospace'; ctx.fillText('No sample data', 10, h / 2); return; }
    const data = smp.data, len = data.length;
    ctx.fillStyle = '#3a6a3a';
    if (len / w > 2) {
        for (let x = 0; x < w; x++) {
            const s0 = Math.floor(x / w * len), s1 = Math.min(Math.floor((x + 1) / w * len), len);
            let mn = 1, mx = -1;
            for (let j = s0; j < s1; j++) { if (data[j] < mn) mn = data[j]; if (data[j] > mx) mx = data[j]; }
            ctx.fillRect(x, (1 - mx) / 2 * h, 1, Math.max(1, (mx - mn) / 2 * h));
        }
    } else {
        ctx.strokeStyle = '#3a6a3a'; ctx.beginPath();
        for (let x = 0; x < w; x++) { const y = (1 - data[Math.floor(x / w * len)]) / 2 * h; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
    }
    if (smp.loop && smp.loopEnd > smp.loopStart) {
        ctx.strokeStyle = '#5a5'; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(smp.loopStart / len * w, 0); ctx.lineTo(smp.loopStart / len * w, h); ctx.stroke();
        ctx.strokeStyle = '#a55';
        ctx.beginPath(); ctx.moveTo(smp.loopEnd / len * w, 0); ctx.lineTo(smp.loopEnd / len * w, h); ctx.stroke();
        ctx.setLineDash([]);
    }
}

// ── Instrument Editor ──────────────────────────────────────────
function buildInstrumentList() {
    const mod = state.mod; if (!mod) return;
    const el = document.getElementById('insList');
    el.innerHTML = '';
    mod.instruments.forEach((ins, i) => {
        const d = document.createElement('div');
        d.className = 'ins-item' + (i === state.selectedIns ? ' active' : '');
        d.innerHTML = '<span class="idx">' + hex2(i + 1) + '</span><span>' + (ins.name || '(empty)') + '</span>';
        d.onclick = () => { state.selectedIns = i; buildInstrumentList(); renderInstrument(); };
        el.appendChild(d);
    });
    renderInstrument();
}

function renderInstrument() {
    const mod = state.mod; if (!mod) return;
    const ins = mod.instruments[state.selectedIns];
    if (!ins) return;
    document.getElementById('insInfo').innerHTML = '<strong>' + hex2(state.selectedIns + 1) + '</strong>: ' + (ins.name || '(unnamed)');
    const envMap = { vol: ins.volEnv, pan: ins.panEnv, pitch: ins.pitchEnv };
    const labels = { vol: 'Vol', pan: 'Pan', pitch: 'Pitch' };
    drawEnvelope(envMap[state.selectedEnvType], labels[state.selectedEnvType], state.selectedEnvType === 'vol');
    renderNoteTable(ins);
    document.querySelectorAll('.env-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.env === state.selectedEnvType);
    });
}

function drawEnvelope(env, label, isVol) {
    const canvas = document.getElementById('envCanvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1);
    const h = canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
    ctx.fillStyle = '#050510'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#444'; ctx.font = '10px monospace';
    if (!env || !env.nodes || !env.nodes.length) { ctx.fillText('No ' + label + ' envelope', 10, h / 2); return; }
    ctx.fillText((env.enabled ? label + ' Envelope (ON)' : label + ' Envelope (OFF)'), 6, 12);
    const padY = 16, drawH = h - padY * 2;
    if (!isVol) {
        const midY = padY + drawH / 2;
        ctx.strokeStyle = '#1a1a2e'; ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke();
    }
    const maxTick = Math.max(1, env.nodes[env.nodes.length - 1].x);
    function nodeY(val) { return isVol ? padY + (1 - val / 64) * drawH : padY + (1 - (val + 32) / 64) * drawH; }
    const clr = { vol: '#3a6a3a', pan: '#6a5a3a', pitch: '#3a5a6a' }[label.toLowerCase()] || '#3a6a3a';
    ctx.strokeStyle = env.enabled ? clr : '#333'; ctx.lineWidth = 1.5; ctx.beginPath();
    env.nodes.forEach((nd, i) => {
        const x = nd.x / maxTick * (w - 20) + 10, y = nodeY(nd.y);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = env.enabled ? '#5a5' : '#444';
    env.nodes.forEach(nd => {
        const x = nd.x / maxTick * (w - 20) + 10, y = nodeY(nd.y);
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    });
    if (env.susLoop) {
        ctx.strokeStyle = '#a85'; ctx.setLineDash([2, 2]);
        [env.slB, env.slE].forEach(idx => {
            if (env.nodes[idx]) { const x = env.nodes[idx].x / maxTick * (w - 20) + 10; ctx.beginPath(); ctx.moveTo(x, padY); ctx.lineTo(x, h - padY); ctx.stroke(); }
        });
        ctx.setLineDash([]);
    }
    if (env.loop) {
        ctx.strokeStyle = '#5a5'; ctx.setLineDash([3, 3]);
        [env.lpB, env.lpE].forEach(idx => {
            if (env.nodes[idx]) { const x = env.nodes[idx].x / maxTick * (w - 20) + 10; ctx.beginPath(); ctx.moveTo(x, padY); ctx.lineTo(x, h - padY); ctx.stroke(); }
        });
        ctx.setLineDash([]);
    }
}

function renderNoteTable(ins) {
    const thead = document.getElementById('ntHead'), tbody = document.getElementById('ntBody');
    thead.innerHTML = '<tr><th>Note</th><th>Smp</th><th>→</th></tr>';
    tbody.innerHTML = '';
    if (!ins.sampleTable || !ins.sampleTable.length) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 120; i++) {
        const p = ins.sampleTable[i];
        if (!p || !p.smp) continue;
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + noteStr(i) + '</td><td>' + hex2(p.smp) + '</td><td>' + noteStr(p.note) + '</td>';
        frag.appendChild(tr);
    }
    tbody.appendChild(frag);
}

// ── Order Editor ───────────────────────────────────────────────
function renderOrderEditor() {
    const mod = state.mod;
    const grid = document.getElementById('orderGrid');
    grid.innerHTML = '';
    if (!mod) return;
    mod.orders.forEach((pat, i) => {
        const d = document.createElement('div');
        d.className = 'ord-edit-cell' + (i === state.ordIdx ? ' current' : '') + (i === state.selectedOrdIdx ? ' editing' : '') +
            (pat === 254 ? ' skip' : '') + (pat === 255 ? ' end' : '');
        d.innerHTML = '<span class="ord-edit-idx">' + hex2(i) + '</span>' +
            (pat === 255 ? '---' : pat === 254 ? '+++' : hex2(pat));
        d.onclick = () => { state.selectedOrdIdx = i; renderOrderEditor(); };
        d.ondblclick = () => {
            const val = prompt('Pattern number (hex), or 254=skip, 255=end:', pat.toString(16));
            if (val === null) return;
            const n = parseInt(val, 16);
            if (isNaN(n) || n < 0 || n > 255) return;
            mod.orders[i] = n;
            updateUI();
        };
        grid.appendChild(d);
    });
}

// ── File List ──────────────────────────────────────────────────
function buildFileList() {
    const el = document.getElementById('fileListPanel');
    const h3 = el.querySelector('h3');
    el.innerHTML = ''; el.appendChild(h3);
    IT_FILES.forEach(f => {
        const a = document.createElement('a');
        a.href = itFileHash(f); a.textContent = f;
        a.dataset.itFile = f;
        a.onclick = (e) => {
            e.preventDefault();
            loadItFile(f, { autoplay: true, updateLocation: true });
        };
        el.appendChild(a);
    });
    updateFileListSelection();
}

function updateFileListSelection() {
    const el = document.getElementById('fileListPanel');
    if (!el) return;
    el.querySelectorAll('[data-it-file]').forEach(link => {
        link.classList.toggle('active', link.dataset.itFile === currentItFile);
    });
}

// ── Events ─────────────────────────────────────────────────────
function isOnPanel(id) { const p = document.getElementById(id); return p && p.classList.contains('active'); }
function switchTab(panel) {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    const tab = document.querySelector('.tab[data-panel="' + panel + '"]');
    if (tab) tab.classList.add('active');
    document.getElementById(panel).classList.add('active');
    if (panel === 'samplePanel') renderSample();
    if (panel === 'instrumentPanel') renderInstrument();
    if (panel === 'orderPanel') renderOrderEditor();
}

document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => switchTab(t.dataset.panel);
});
document.querySelectorAll('.env-tab').forEach(t => {
    t.onclick = () => { state.selectedEnvType = t.dataset.env; renderInstrument(); };
});

document.getElementById('btnOpen').onclick = () => document.getElementById('fileInput').click();
document.getElementById('fileInput').onchange = (e) => {
    if (!e.target.files[0]) return;
    const fr = new FileReader();
    fr.onload = () => { loadModule(fr.result); e.target.value = ''; };
    fr.readAsArrayBuffer(e.target.files[0]);
};

function startPlay(fromStart) {
    if (!state.mod) return;
    if (fromStart) { state.ordIdx = 0; state.row = 0; }
    state.patternLoop = false;
    return initAudio().then(() => {
        state.mod.samples.forEach(s => { s._abuf = null; });
        state.playing = true;
        state.tick = state.speed - 1;
        state.schedTime = state.ctx.currentTime;
        state.playStartTime = state.ctx.currentTime;
        state.lastDisplayRow = -1; state.lastDisplayOrd = -1;
        state.displayRow = state.row; state.displayOrd = state.ordIdx;
        loop();
    }).catch(() => toast('Press F5 or Play to start audio'));
}

function startPlayPattern() {
    if (!state.mod) return;
    state.row = 0;
    state.patternLoop = true;
    initAudio().then(() => {
        state.mod.samples.forEach(s => { s._abuf = null; });
        state.playing = true;
        state.tick = state.speed - 1;
        state.schedTime = state.ctx.currentTime;
        state.playStartTime = state.ctx.currentTime;
        state.lastDisplayRow = -1; state.lastDisplayOrd = -1;
        state.displayRow = state.row; state.displayOrd = state.ordIdx;
        loop();
    });
}

document.getElementById('btnPlay').onclick = () => startPlay(false);
document.getElementById('btnStop').onclick = () => { stopPlayback(); updateUI(); };
document.getElementById('inputSpeed').onchange = (e) => { state.speed = Math.max(1, Math.min(255, parseInt(e.target.value) || 6)); };
document.getElementById('inputTempo').onchange = (e) => { state.tempo = Math.max(32, Math.min(255, parseInt(e.target.value) || 125)); };

document.getElementById('btnNewPat').onclick = () => {
    if (!state.mod) return;
    const rows = parseInt(prompt('Number of rows (1-200):', '64'));
    if (!rows || rows < 1 || rows > 200) return;
    const newIdx = state.mod.patterns.length;
    state.mod.patterns.push(emptyPat(rows));
    toast('Created pattern ' + hex2(newIdx) + ' (' + rows + ' rows)');
    state.mod.orders.push(newIdx);
    updateUI();
};

document.getElementById('ordInsert').onclick = () => {
    if (!state.mod) return;
    state.mod.orders.splice(state.selectedOrdIdx + 1, 0, 0);
    state.selectedOrdIdx++;
    updateUI();
};
document.getElementById('ordDelete').onclick = () => {
    if (!state.mod || state.mod.orders.length <= 1) return;
    state.mod.orders.splice(state.selectedOrdIdx, 1);
    if (state.selectedOrdIdx >= state.mod.orders.length) state.selectedOrdIdx = state.mod.orders.length - 1;
    updateUI();
};
document.getElementById('ordAddEnd').onclick = () => {
    if (!state.mod) return;
    state.mod.orders.push(255);
    updateUI();
};
document.getElementById('ordAddSkip').onclick = () => {
    if (!state.mod) return;
    state.mod.orders.push(254);
    updateUI();
};

document.getElementById('smpPreview').onclick = () => {
    if (!state.mod) return;
    initAudio().then(() => {
        const smp = state.mod.samples[state.selectedSmp];
        if (!smp || !smp.data) { toast('No sample data'); return; }
        const ab = buildAudioBuffer(smp);
        if (!ab) return;
        const rate = smp.c5speed || 22050;
        const src = state.ctx.createBufferSource();
        src.buffer = ab;
        if (smp.loop && smp.loopEnd > smp.loopStart) {
            src.loop = true;
            if (smp._ppLoopStart != null) { src.loopStart = smp._ppLoopStart; src.loopEnd = smp._ppLoopEnd; }
            else { src.loopStart = smp.loopStart / rate; src.loopEnd = smp.loopEnd / rate; }
        }
        const g = state.ctx.createGain(); g.gain.value = 0.5;
        src.connect(g); g.connect(state.master); src.start();
        if (state.previewSrc) try { state.previewSrc.stop(); } catch (_) {}
        state.previewSrc = src;
        if (!smp.loop) setTimeout(() => { try { src.stop(); } catch (_) {} }, 5000);
    });
};

// ── QWERTY Piano Keyboard ─────────────────────────────────────
const PIANO_MAP = {
    'z': 0, 's': 1, 'x': 2, 'd': 3, 'c': 4, 'v': 5, 'g': 6, 'b': 7, 'h': 8, 'n': 9, 'j': 10, 'm': 11,
    'q': 12, '2': 13, 'w': 14, '3': 15, 'e': 16, 'r': 17, '5': 18, 't': 19, '6': 20, 'y': 21, '7': 22, 'u': 23,
    'i': 24, '9': 25, 'o': 26, '0': 27, 'p': 28
};

function pianoNoteForKey(key) {
    const offset = PIANO_MAP[key.toLowerCase()];
    if (offset == null) return -1;
    return state.pianoOctave * 12 + offset;
}

function pianoNoteOn(note) {
    if (!state.mod || !state.ctx) return;
    const smp = state.mod.samples[state.selectedSmp];
    if (!smp || !smp.data) return;
    const ab = buildAudioBuffer(smp);
    if (!ab) return;
    const rate = smp.c5speed || 44100;
    const src = state.ctx.createBufferSource();
    src.buffer = ab;
    if (smp.loop && smp.loopEnd > smp.loopStart) {
        src.loop = true;
        if (smp._ppLoopStart != null) { src.loopStart = smp._ppLoopStart; src.loopEnd = smp._ppLoopEnd; }
        else { src.loopStart = smp.loopStart / rate; src.loopEnd = smp.loopEnd / rate; }
    }
    const g = state.ctx.createGain(); g.gain.value = 0.5;
    src.connect(g); g.connect(state.master);
    src.playbackRate.value = Math.pow(2, (note - 60) / 12);
    src.start();
    return { src, gain: g };
}

function pianoNoteOff(handle) {
    if (!handle) return;
    try {
        handle.gain.gain.setValueAtTime(handle.gain.gain.value, state.ctx.currentTime);
        handle.gain.gain.linearRampToValueAtTime(0, state.ctx.currentTime + 0.05);
        handle.src.stop(state.ctx.currentTime + 0.06);
    } catch (_) {}
}

// ── Pattern editing via keyboard ──────────────────────────────
function editPatternKey(e) {
    const mod = state.mod;
    if (!mod || state.playing) return false;
    const patIdx = mod.orders[state.ordIdx];
    if (patIdx == null || patIdx >= mod.patterns.length) return false;
    const pat = mod.patterns[patIdx];
    if (!pat || !pat.data) return false;
    const r = state.editCursorRow, c = state.editCursorCh;
    if (r >= pat.rows || c >= 64) return false;
    const cell = pat.data[r][c];
    const key = e.key;

    if (key === 'ArrowUp') { state.editCursorRow = Math.max(0, r - 1); updateUI(); return true; }
    if (key === 'ArrowDown') { state.editCursorRow = Math.min(pat.rows - 1, r + 1); updateUI(); return true; }
    if (key === 'ArrowLeft') { state.editCursorCh = Math.max(0, c - 1); updateUI(); return true; }
    if (key === 'ArrowRight') { state.editCursorCh = Math.min(63, c + 1); updateUI(); return true; }
    if (key === 'Tab') { e.preventDefault(); state.editCursorCh = (c + 1) % 64; updateUI(); return true; }

    if (key === 'Delete' || key === 'Backspace') {
        cell.note = null; cell.inst = null; cell.vol = null; cell.eff = 0; cell.param = 0;
        state.editCursorRow = Math.min(pat.rows - 1, r + 1);
        updateUI(); return true;
    }

    if (key === '`' || key === '~') {
        cell.note = 254; // note cut
        state.editCursorRow = Math.min(pat.rows - 1, r + 1);
        updateUI(); return true;
    }
    if (key === '1' && e.altKey) {
        cell.note = 255; // note off
        state.editCursorRow = Math.min(pat.rows - 1, r + 1);
        updateUI(); return true;
    }

    const pianoNote = pianoNoteForKey(key);
    if (pianoNote >= 0 && pianoNote <= 119) {
        cell.note = pianoNote;
        if (state.selectedIns >= 0) cell.inst = state.selectedIns + 1;
        state.editCursorRow = Math.min(pat.rows - 1, r + 1);
        initAudio().then(() => {
            const handle = pianoNoteOn(pianoNote);
            if (handle) setTimeout(() => pianoNoteOff(handle), 200);
        });
        updateUI();
        return true;
    }

    return false;
}

buildFileList();
if (INITIAL_FILE) loadItFile(INITIAL_FILE, { autoplay: AUTOPLAY_INITIAL_FILE });
else if (!loadFromStorage()) toast('Open an .it file or click one from the sidebar');

// ── Keyboard Shortcuts ────────────────────────────────────────
function loadFileByIndex(idx) {
    if (idx < 0 || idx >= IT_FILES.length) return;
    loadItFile(IT_FILES[idx], { autoplay: true, updateLocation: true });
}

function currentFileIndex() {
    return IT_FILES.findIndex(f => f === currentItFile);
}

const HELP_HTML = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:200;display:flex;align-items:center;justify-content:center" id="helpOverlay" onclick="this.remove()">' +
    '<div style="background:#0a0a14;border:1px solid #333;padding:16px 24px;max-width:540px;font-size:10px;line-height:1.8;color:#888" onclick="event.stopPropagation()">' +
    '<div style="font-size:12px;color:#8c8;margin-bottom:8px;border-bottom:1px solid #222;padding-bottom:4px">Keyboard Shortcuts</div>' +
    '<div style="display:grid;grid-template-columns:auto 1fr;gap:1px 12px">' +
    '<kbd>? / F1</kbd><span>This help</span>' +
    '<kbd>F2</kbd><span>Pattern editor</span>' +
    '<kbd>F3</kbd><span>Sample editor</span>' +
    '<kbd>F4</kbd><span>Instrument editor</span>' +
    '<kbd>F5</kbd><span>Play / Ctrl+F5 from start</span>' +
    '<kbd>F6</kbd><span>Play pattern (loop)</span>' +
    '<kbd>F8</kbd><span>Stop</span>' +
    '<kbd>F9 / F10</kbd><span>Prev/next order</span>' +
    '<kbd>F11 / F12</kbd><span>Prev/next file / Orders tab</span>' +
    '<kbd>* / /</kbd><span>Octave up/down</span>' +
    '<kbd>Ctrl+O</kbd><span>Open .it file</span>' +
    '<kbd>Ctrl+L</kbd><span>Toggle file list</span>' +
    '<kbd>+ / -</kbd><span>Next/prev order</span>' +
    '<kbd>[ / ]</kbd><span>Next/prev sample</span>' +
    '<kbd>Ctrl+↑↓</kbd><span>Tempo ±1</span>' +
    '<kbd>Ctrl+←→</kbd><span>Speed ±1</span>' +
    '<kbd>Arrows</kbd><span>Navigate pattern</span>' +
    '<kbd>Delete</kbd><span>Clear cell</span>' +
    '<kbd>`</kbd><span>Note cut (===)</span>' +
    '<kbd>Alt+1</kbd><span>Note off (^^^)</span>' +
    '</div>' +
    '<div style="color:#5a5;margin-top:8px;font-size:9px;border-top:1px solid #222;padding-top:4px">Piano (Sample/Instrument/Pattern panels):</div>' +
    '<div style="font-size:9px;color:#556;line-height:1.6;margin-top:2px">' +
    'Lower: Z S X D C V G B H N J M &nbsp; Upper: Q 2 W 3 E R 5 T 6 Y 7 U<br>' +
    '<kbd>,</kbd> <kbd>.</kbd> or <kbd>*</kbd> <kbd>/</kbd> change octave' +
    '</div>' +
    '<div style="color:#333;margin-top:8px;font-size:9px">Esc or click to close</div></div></div>';

document.addEventListener('keydown', (e) => {
    if (impulseGeneration !== window.__industreeImpulseGeneration || !document.getElementById(mountId)) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const ctrl = e.ctrlKey || e.metaKey;

    // Piano on sample/instrument/pattern panels
    if (!ctrl && !e.altKey && state.mod && (isOnPanel('samplePanel') || isOnPanel('instrumentPanel'))) {
        const key = e.key.toLowerCase();
        const note = pianoNoteForKey(key);
        if (note >= 0 && note <= 119 && !state.pianoKeys[key]) {
            e.preventDefault();
            initAudio().then(() => {
                state.pianoKeys[key] = pianoNoteOn(note);
                const hint = document.getElementById('pianoHint');
                hint.classList.add('active');
                hint.textContent = noteStr(note) + ' Oct:' + state.pianoOctave;
            });
            return;
        }
    }

    // Pattern editing on pattern panel
    if (!ctrl && isOnPanel('patternPanel') && !state.playing) {
        if (editPatternKey(e)) { e.preventDefault(); return; }
    }

    switch (e.key) {
    case 'F1': case '?':
        e.preventDefault();
        if (document.getElementById('helpOverlay')) document.getElementById('helpOverlay').remove();
        else document.body.insertAdjacentHTML('beforeend', HELP_HTML);
        break;
    case 'Escape':
        { const h = document.getElementById('helpOverlay'); if (h) { h.remove(); e.preventDefault(); } }
        break;
    case 'F2': e.preventDefault(); switchTab('patternPanel'); break;
    case 'F3': e.preventDefault(); switchTab('samplePanel'); break;
    case 'F4': e.preventDefault(); switchTab('instrumentPanel'); break;
    case 'F12':
        if (!ctrl) { e.preventDefault(); switchTab('orderPanel'); }
        break;
    case 'F5':
        e.preventDefault(); startPlay(ctrl);
        break;
    case 'F6':
        e.preventDefault(); startPlayPattern();
        break;
    case 'F8':
        e.preventDefault(); stopPlayback(); updateUI();
        break;
    case 'F9':
        e.preventDefault();
        if (state.mod) { state.ordIdx = Math.max(0, state.ordIdx - 1); state.row = 0; updateUI(); }
        break;
    case 'F10':
        e.preventDefault();
        if (state.mod) { state.ordIdx = Math.min(state.mod.orders.length - 1, state.ordIdx + 1); state.row = 0; updateUI(); }
        break;
    case 'F11': e.preventDefault(); { const ci = currentFileIndex(); loadFileByIndex(Math.max(0, ci - 1)); } break;

    case '*':
        state.pianoOctave = Math.min(9, state.pianoOctave + 1);
        updateInfoHeader();
        document.getElementById('pianoHint').textContent = 'Oct: ' + state.pianoOctave;
        break;
    case '/':
        if (!ctrl) {
            e.preventDefault();
            state.pianoOctave = Math.max(0, state.pianoOctave - 1);
            updateInfoHeader();
            document.getElementById('pianoHint').textContent = 'Oct: ' + state.pianoOctave;
        }
        break;
    case ',':
        if (!ctrl) { state.pianoOctave = Math.max(0, state.pianoOctave - 1); updateInfoHeader(); }
        break;
    case '.':
        if (!ctrl) { state.pianoOctave = Math.min(9, state.pianoOctave + 1); updateInfoHeader(); }
        break;

    case '+': case '=':
        if (!ctrl && state.mod) { state.ordIdx = Math.min(state.mod.orders.length - 1, state.ordIdx + 1); state.row = 0; updateUI(); }
        break;
    case '-':
        if (!ctrl && state.mod && !isOnPanel('patternPanel')) { state.ordIdx = Math.max(0, state.ordIdx - 1); state.row = 0; updateUI(); }
        break;
    case '[':
        if (state.mod) { state.selectedSmp = Math.max(0, state.selectedSmp - 1); buildSampleList(); }
        break;
    case ']':
        if (state.mod) { state.selectedSmp = Math.min(state.mod.samples.length - 1, state.selectedSmp + 1); buildSampleList(); }
        break;
    case 'o':
        if (ctrl) { e.preventDefault(); document.getElementById('fileInput').click(); }
        break;
    case 'l':
        if (ctrl) { e.preventDefault(); const fl = document.getElementById('fileListPanel'); fl.style.display = fl.style.display === 'none' ? '' : 'none'; }
        break;
    case 'ArrowUp':
        if (ctrl) { e.preventDefault(); state.tempo = Math.min(255, state.tempo + 1); updateInfoHeader(); }
        break;
    case 'ArrowDown':
        if (ctrl) { e.preventDefault(); state.tempo = Math.max(32, state.tempo - 1); updateInfoHeader(); }
        break;
    case 'ArrowRight':
        if (ctrl) { e.preventDefault(); state.speed = Math.min(255, state.speed + 1); updateInfoHeader(); }
        break;
    case 'ArrowLeft':
        if (ctrl) { e.preventDefault(); state.speed = Math.max(1, state.speed - 1); updateInfoHeader(); }
        break;
    }
});

document.addEventListener('keyup', (e) => {
    if (impulseGeneration !== window.__industreeImpulseGeneration || !document.getElementById(mountId)) return;
    const key = e.key.toLowerCase();
    if (state.pianoKeys[key]) {
        pianoNoteOff(state.pianoKeys[key]);
        delete state.pianoKeys[key];
        if (Object.keys(state.pianoKeys).length === 0) {
            const hint = document.getElementById('pianoHint');
            hint.classList.remove('active');
            hint.textContent = 'Piano: ZSXDCVGBHNJM / Q2W3ER5T6Y7U  * / octave';
        }
    }
});
    window.indusTreeImpulseLoadFile = loadItFile;
    window.__industreeImpulseStop = () => { try { stopPlayback(); } catch (_) {} };
  };
})();
