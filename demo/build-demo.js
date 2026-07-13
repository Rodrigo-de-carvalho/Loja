'use strict'

/*
 * Monta a demo do PDV num único arquivo HTML auto-contido (sem backend):
 * CSS, JsBarcode, jsPDF, o mock da API e o app.js real, todos inline.
 * Uso: node demo/build-demo.js [saida.html]
 */

const fs = require('fs')
const path = require('path')

const raiz = path.join(__dirname, '..')
const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8')

const html   = ler('renderer/index.html')
const css    = ler('renderer/styles.css')
const appJs  = ler('renderer/js/app.js')
const mockJs = ler('demo/mock-api.js')
const jsbar  = ler('node_modules/jsbarcode/dist/JsBarcode.all.min.js')
const jspdf  = ler('node_modules/jspdf/dist/jspdf.umd.min.js')

// Conteúdo do <body> do app real (o host da demo fornece o esqueleto da página)
const body = html.match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script src="\.\.\/node_modules\/jsbarcode[^>]*><\/script>/, () => `<script>\n${jsbar}\n</script>`)
  .replace(/<script src="\.\.\/node_modules\/jspdf[^>]*><\/script>/,    () => `<script>\n${jspdf}\n</script>`)
  .replace(/<script src="js\/app\.js"><\/script>/, () => `<script>\n${mockJs}\n</script>\n<script>\n${appJs}\n</script>`)

const saida = `<title>Cantinho do Bebê — PDV (Demo)</title>
<style>
${css}
</style>
${body}
`

const destino = process.argv[2] || path.join(__dirname, 'demo.html')
fs.writeFileSync(destino, saida)
console.log(`Demo gerada: ${destino} (${(saida.length / 1024).toFixed(0)} KB)`)
