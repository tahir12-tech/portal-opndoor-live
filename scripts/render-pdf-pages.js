// RENDER EVERY PAGE OF A PDF TO A PNG, so it can be READ rather than
// decoded.
//
// Matt (dv): "render each page to an image and read it visually
// instead of extracting text."
//
// WHY THIS EXISTS AT ALL. Both shipped PDFs use subset fonts, so
// their text is glyph codes that need per-font ToUnicode resolution.
// Three extraction attempts produced, in order: "(a)(a)(a)"; most of
// the words with the DIGITS CORRUPTED, rendering a GBP 120,000 cap as
// "GBP 12f,fff"; and worse. A rendered page has no encoding to get
// wrong -- it is what the reader sees.
//
// WHY JXA AND NOT A TOOL. There is no pdftoppm, ghostscript or
// pdfseparate on this machine, and qlmanage only ever thumbnails page
// one. Quartz is built into macOS and reachable from JXA, so this
// needs nothing installed.
//
//   osascript -l JavaScript scripts/render-pdf-pages.js \
//     public/help-docs/opndoor-sales-and-conversation-guide.pdf /tmp/pages sales
//
// Then read /tmp/pages/sales-p1.png and the rest. ALWAYS cross-check
// any figure against a second source before transcribing it: the
// landlord guide carries the cap, the legal costs and the term.

ObjC.import('Quartz'); ObjC.import('AppKit'); ObjC.import('Foundation');
function run(argv) {
  var path = argv[0], outDir = argv[1], tag = argv[2];
  var url = $.NSURL.fileURLWithPath($(path));
  var doc = $.PDFDocument.alloc.initWithURL(url);
  if (!doc.js) return 'FAILED to open';
  var n = doc.pageCount;
  for (var i = 0; i < n; i++) {
    var page = doc.pageAtIndex(i);
    var img = page.thumbnailOfSizeForBox($.NSMakeSize(1240, 1754), 0);
    var tiff = img.TIFFRepresentation;
    var rep = $.NSBitmapImageRep.imageRepWithData(tiff);
    var png = rep.representationUsingTypeProperties($.NSPNGFileType, $());
    var out = outDir + '/' + tag + '-p' + (i + 1) + '.png';
    png.writeToFileAtomically($(out), true);
  }
  return 'pages:' + n;
}
