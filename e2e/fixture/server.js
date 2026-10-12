// A small JSON API for the fishStack end-to-end run.
const http = require('node:http')

const port = Number(process.env.COMMISSION_DEV_PORT || process.env.PORT || 4517)
const items = [
  { id: 1, name: 'Chisel' },
  { id: 2, name: 'Mallet' },
]

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`)
    const match = /^\/items\/(\d+)$/.exec(url.pathname)
    if (req.method === 'GET' && url.pathname === '/') return reply(res, 200, { ok: true })
    if (req.method === 'GET' && url.pathname === '/items') return reply(res, 200, items)
    if (req.method === 'GET' && match) {
      const item = items.find(one => one.id === Number(match[1]))
      return item ? reply(res, 200, item) : reply(res, 404, { error: 'not found' })
    }
    if (req.method === 'POST' && url.pathname === '/items') {
      let body = ''
      req.on('data', chunk => (body += chunk))
      req.on('end', () => {
        let parsed
        try {
          parsed = JSON.parse(body)
        } catch {
          return reply(res, 400, { error: 'body is not JSON' })
        }
        if (typeof parsed.name !== 'string') return reply(res, 422, { error: 'name is required' })
        const item = { id: items.length + 1, name: parsed.name }
        items.push(item)
        reply(res, 201, item)
      })
      return
    }
    reply(res, 404, { error: 'no such route' })
  })
  .listen(port, () => console.log(`listening on ${port}`))
