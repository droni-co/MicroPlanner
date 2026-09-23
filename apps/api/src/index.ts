import express from 'express'
import morgan from 'morgan'


const app = express()
app.use(morgan('tiny'))
app.disable('x-powered-by')
const port = 3000

app.get('/', (_req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})