// A 3D-printable model of the cage as a .3mf file (3D Manufacturing Format,
// what Bambu Studio, PrusaSlicer, OrcaSlicer and Cura open): the tubes that
// are fitted, each a part of one object -- so it prints as one piece, and
// each tube can still be picked out in the slicer -- with its color from the
// checklist, scaled down and standing on the build plate.
//   Print3MF.build(parts, { title, scale }) -> Promise<Blob>
//     parts: [{ name, color: "#rrggbb", positions: Float32Array }] -- triangles
//     (3 vertices each, x y z in mm, Z up), as cage_view.js's printParts() gives them.
// A .3mf is a zip of a few XML files; written here, deflated where the browser
// can (CompressionStream), else stored. For Bambu Studio (and OrcaSlicer): the
// colors as a materials-extension color group (each color becomes a filament
// there) and Metadata/model_settings.config with each part's name -- which it
// reads from any 3mf, matching each <part id> to its mesh object's id.
(function () {
  "use strict";

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const num = (x) => (Math.round(x * 1000) / 1000).toString();

  // ---- The model ---------------------------------------------------------
  // Each part's triangles as a mesh: shared vertices merged (to 0.001 mm), so
  // the slicer sees a closed surface rather than a soup of loose triangles.
  function meshXml(positions, scale, shift) {
    const index = new Map();
    const verts = [];
    const tris = [];
    const vertexId = (i) => {
      const x = num((positions[i] - shift[0]) * scale), y = num((positions[i + 1] - shift[1]) * scale), z = num((positions[i + 2] - shift[2]) * scale);
      const key = x + " " + y + " " + z;
      let id = index.get(key);
      if (id === undefined) {
        id = verts.length;
        index.set(key, id);
        verts.push('<vertex x="' + x + '" y="' + y + '" z="' + z + '"/>');
      }
      return id;
    };
    for (let i = 0; i + 8 < positions.length; i += 9) {
      const a = vertexId(i), b = vertexId(i + 3), c = vertexId(i + 6);
      // (A triangle whose corners merged into fewer than 3 is no triangle.)
      if (a !== b && b !== c && a !== c) tris.push('<triangle v1="' + a + '" v2="' + b + '" v3="' + c + '"/>');
    }
    return { xml: "<mesh><vertices>" + verts.join("") + "</vertices><triangles>" + tris.join("") + "</triangles></mesh>", triangles: tris.length };
  }

  function modelXml(parts, opts) {
    const scale = opts.scale || 1;
    // On the plate: the lowest point at z = 0, centered on x and y.
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    parts.forEach((p) => {
      for (let i = 0; i < p.positions.length; i += 3) {
        for (let k = 0; k < 3; k++) { const v = p.positions[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
      }
    });
    const shift = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
    // One entry per distinct color (the slicer's filaments).
    const colors = [...new Set(parts.map((p) => p.color.toUpperCase()))];
    const objects = [];
    const components = [];
    const named = [];
    parts.forEach((p, i) => {
      const id = i + 2; // (1: the colors)
      const mesh = meshXml(p.positions, scale, shift);
      if (!mesh.triangles) return;
      objects.push('<object id="' + id + '" type="model" name="' + esc(p.name) + '" pid="1" pindex="' + colors.indexOf(p.color.toUpperCase()) + '">' + mesh.xml + "</object>");
      components.push('<component objectid="' + id + '"/>');
      named.push({ id, name: p.name });
    });
    const assemblyId = parts.length + 2;
    const model = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">',
      '<metadata name="Title">' + esc(opts.title || "Rollcage") + "</metadata>",
      '<metadata name="Application">' + esc(opts.application || "Frog Racing rollcage app") + "</metadata>",
      '<metadata name="Description">' + esc("Scale 1:" + Math.round(1 / scale)) + "</metadata>",
      "<resources>",
      '<m:colorgroup id="1">' + colors.map((c) => '<m:color color="' + esc(c) + '"/>').join("") + "</m:colorgroup>",
      objects.join(""),
      '<object id="' + assemblyId + '" type="model" name="' + esc(opts.title || "Rollcage") + '"><components>' + components.join("") + "</components></object>",
      "</resources>",
      '<build><item objectid="' + assemblyId + '"/></build>',
      "</model>",
    ].join("\n");
    // Bambu Studio's names for the object and each of its parts.
    const settings = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<config>",
      '  <object id="' + assemblyId + '">',
      '    <metadata key="name" value="' + esc(opts.title || "Rollcage") + '"/>',
      '    <metadata key="extruder" value="1"/>',
      ...named.map((x) => '    <part id="' + x.id + '" subtype="normal_part"><metadata key="name" value="' + esc(x.name) + '"/></part>'),
      "  </object>",
      "</config>",
    ].join("\n");
    return { model, settings };
  }

  const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
  const RELS = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';

  // ---- The zip -------------------------------------------------------------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function deflate(bytes) {
    if (typeof CompressionStream === "undefined") return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { return null; }
  }
  async function zip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = enc.encode(f.text);
      const packed = await deflate(data);
      const method = packed && packed.length < data.length ? 8 : 0;
      const body = method === 8 ? packed : data;
      const crc = crc32(data);
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0, true); head.setUint16(8, method, true);
      head.setUint16(10, time, true); head.setUint16(12, date, true); head.setUint32(14, crc, true);
      head.setUint32(18, body.length, true); head.setUint32(22, data.length, true); head.setUint16(26, name.length, true); head.setUint16(28, 0, true);
      chunks.push(new Uint8Array(head.buffer), name, body);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0, true); cd.setUint16(10, method, true);
      cd.setUint16(12, time, true); cd.setUint16(14, date, true); cd.setUint32(16, crc, true); cd.setUint32(20, body.length, true); cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true); cd.setUint16(30, 0, true); cd.setUint16(32, 0, true); cd.setUint16(34, 0, true); cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true); cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + body.length;
    }
    const cdSize = central.reduce((n, c) => n + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: "model/3mf" });
  }

  async function build(parts, opts) {
    const o = opts || {};
    const { model, settings } = modelXml(parts, o);
    return zip([
      { name: "[Content_Types].xml", text: CONTENT_TYPES },
      { name: "_rels/.rels", text: RELS },
      { name: "3D/3dmodel.model", text: model },
      { name: "Metadata/model_settings.config", text: settings },
    ]);
  }

  window.Print3MF = { build };
})();
