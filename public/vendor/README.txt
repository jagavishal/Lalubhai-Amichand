Self-hosted third-party scripts for Export Documentation's "All Documents" /
Excel downloads (public/js/pages/export-docs.js).

These used to load from cdnjs.cloudflare.com at runtime. That is what made
"download not working" — any firewall, proxy, or CDN hiccup on the office
network left the download stuck with nothing produced. Same-origin removes
that failure mode entirely: if these can't load, the app itself isn't
loading either.

  html2pdf.bundle.min.js  html2pdf.js 0.10.1 (bundles html2canvas + jsPDF)
                          https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js
  jszip.min.js            JSZip 3.10.1
                          https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
  xlsx.full.min.js        SheetJS (the `xlsx` npm package's own browser build —
                          copied straight from node_modules/xlsx/dist/, not
                          downloaded separately, so it always matches the
                          version server-side code parses uploads with)

All MIT-licensed. To update: re-download the cdnjs files at a newer pinned
version, or re-copy node_modules/xlsx/dist/xlsx.full.min.js after bumping
the `xlsx` dependency in package.json.
