import express from 'express'
import morgan from 'morgan'
import session from 'express-session'
import dotenv from 'dotenv'
dotenv.config()

const app = express()
app.use(morgan('tiny'))
app.disable('x-powered-by')
app.use(session({
    secret: String(process.env.APP_KEY), // Clave para firmar el cookie de la sesión
    resave: false,                   // Evita guardar la sesión si no sufrió modificaciones
    saveUninitialized: false,        // No guarda sesiones vacías/no inicializadas
    cookie: { secure: false }        // Cambiar a true si usas HTTPS en producción
}));
const port = 3000

app.get('/', (req, res) => {
  return res.json(req.session)
})

app.get('/random', (req, res) => {
  req.session.user = 'Juan';
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})