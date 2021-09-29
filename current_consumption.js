const Influx = require('influx')
const path = require('path')
const express = require('express')
const bodyParser = require("body-parser")
const http = require('http')
const mqtt = require('mqtt')
const cors = require('cors')
const socketio = require('socket.io')
const dotenv = require('dotenv')
const pjson = require('./package.json')

dotenv.config()

const DB_name = process.env.DB_NAME || 'current_consumption'
const measurement_name = 'current'
const MQTT_topic = process.env.MQTT_TOPIC || "power/status"
const LOGGING_PERIOD = process.env.LOGGING_PERIOD || 1 * 60 * 1000
const port = process.env.APP_PORT || 80

var current_sample = {}
var last_logging_time = new Date()

const app = express()
const http_server = http.Server(app)
const io = socketio(http_server)



// Todo: get URL from env var
const mqtt_client  = mqtt.connect(process.env.MQTT_URL,{
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD
})

const influx = new Influx.InfluxDB({
  host: process.env.INFLUXDB_URL,
  database: DB_name,
})





app.use(cors())

app.get('/', (req, res) => {
  res.send({
    application_name: `Current consumption monitoring API`,
    version: pjson.version,
    influxdb: {
      influxdb_url: process.env.INFLUXDB_URL || 'undefined',
      db_name: DB_name,
      measurement_name,
    },

    mqtt: {
      broker_url: process.env.MQTT_URL || 'undefined',
      topic: MQTT_topic,
    },
    logging_period: LOGGING_PERIOD,
  })
})

app.get('/data', (req, res) => {
  const query_string = `select * from ${measurement_name}`
  influx.query(query_string)
  .then( result => res.send(result) )
  .catch( error => res.status(500) );
})

app.get('/current_consumption', (req, res) => {
  const query_string = `select * from ${measurement_name} GROUP BY * ORDER BY DESC LIMIT 1`
  influx.query(query_string)
  .then( result => res.send(result[0]) )
  .catch( error => res.status(500).send(`Error getting current consumption from Influx: ${error}`) );
})




const drop_database = async (req, res) => {

  // unused at the moment

  try {
    await influx.dropDatabase(DB_name)
    const names = await influx.getDatabaseNames()
    if (names.includes(DB_name)) throw 'Database was not removed successfully'
    await influx.createDatabase(DB_name)
    const query_string = `CREATE RETENTION POLICY "renention_policy" ON "${DB_name}" DURATION 72h REPLICATION 1 DEFAULT`
    const result = await influx.query(query_string)
    res.send(result)

  }

  catch (error) {
    res.status(500).send(error)
  }
}


const save_point = (current_sample) => {
  // Log periodically
  const now = new Date()
  if( now - last_logging_time < LOGGING_PERIOD) return

  last_logging_time = now

  const points = [
    {
      measurement: measurement_name,
      tags: { unit: "A", },
      fields: {
        phase_1: Number(current_sample.phase_1),
        phase_2: Number(current_sample.phase_2),
        total: Number(current_sample.phase_1) + Number(current_sample.phase_2),
      },
      timestamp: new Date(),
    }
  ]

  const parameters = {
    database: DB_name,
    precision: 's',
  }

  influx.writePoints( points, parameters )
  .then( () => {
    console.log(`[InfluxDB] Measurement saved`)
  })
  .catch(error => {
    console.error(`[InfluxDB] Error saving data to InfluxDB! ${error}`)
  })
}

http_server.listen(port, () => console.log(`[Express] Current consumption listening on 0.0.0.0:${port}`))


mqtt_client.on('connect', () => {
  console.log("[MQTT] Connected to MQTT broker")
  mqtt_client.subscribe(MQTT_topic);
})


mqtt_client.on('message', (topic, payload) => {
  console.log(`[MQTT] Message arrived on ${topic}: ${String(payload)}`)

  // Current sample is not very useful asd a global variable
  current_sample = JSON.parse(payload)

  // Update websocket clients
  io.emit('current_consumption',current_sample)

  save_point(current_sample)

})


io.on('connection', (socket) => {
  console.log('[WS] a user connected')
})
