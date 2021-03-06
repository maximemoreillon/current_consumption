const Influx = require('influx');
const path = require('path');
const express = require('express');
const bodyParser = require("body-parser");
const http = require('http');
const mqtt = require('mqtt');
const cors = require('cors');
const socketio = require('socket.io');
const dotenv = require('dotenv');

const secrets = require('./secrets.js');

dotenv.config();

const DB_name = 'current_consumption'
const measurement_name = 'current'

var current_sample = {};
var last_logging_time = new Date();

const app = express();
app.use(cors())

const http_server = http.Server(app);
const io = socketio(http_server);

var port = 80
if(process.env.APP_PORT) port=process.env.APP_PORT

// Todo: get URL from env var
const mqtt_client  = mqtt.connect('mqtt://192.168.1.2', secrets.mqtt);

const influx = new Influx.InfluxDB({
  host: secrets.influx.url,
  database: DB_name,
  schema: [
    {
      measurement: 'current',
      fields: {
        phase_1: Influx.FieldType.FLOAT,
        phase_2: Influx.FieldType.FLOAT,
        total: Influx.FieldType.FLOAT,
      },
      tags: ['unit']
    }
  ]
})


const MQTT_topic = "power/status"
const LOGGING_PERIOD = 2 * 60 * 1000

app.get('/', (req, res) => {
  res.send('/Current consumption API, Maxime Moreillon')
})

app.get('/data', (req, res) => {
  influx.query(`
    select * from ${measurement_name}
  `)
  .then( result => res.send(result) )
  .catch( error => res.status(500) );
})

app.get('/current_consumption', (req, res) => {
  influx.query(`select * from ${measurement_name} GROUP BY * ORDER BY DESC LIMIT 1`)
  .then( result => res.send(result[0]) )
  .catch( error => res.status(500).send(`Error getting current consumption from Influx: ${error}`) );
})

function drop_database(req, res) {
  influx.dropDatabase(DB_name)
  .then( () => {
    influx.getDatabaseNames()
    .then(names => {
      if (!names.includes(DB_name)) {
        influx.createDatabase(DB_name)
        .then(() => {
          influx.query(`CREATE RETENTION POLICY "renention_policy" ON "${DB_name}" DURATION 72h REPLICATION 1 DEFAULT`)
          .then( result => res.send('OK') )
          .catch( error =>  res.status(500).send(error) );
        })
        .catch( error =>  res.status(500).send(error) );
      }
    })
    .catch(error => res.status(500).send(error));
  })
  .catch(error => res.status(500).send(error));
}

http_server.listen(port, () => console.log(`[Express] Current consumption listening on 0.0.0.0:${port}`))


mqtt_client.on('connect', () => {
  console.log("[MQTT] Connected to MQTT broker")
  mqtt_client.subscribe(MQTT_topic);
});

mqtt_client.on('message', (topic, payload) => {
  console.log(`[MQTT] Message arrived on ${topic}: ${String(payload)}`)

  current_sample = JSON.parse(payload)

  io.emit('current_consumption',current_sample)


  // Log periodically
  let now = new Date();
  if( now - last_logging_time > LOGGING_PERIOD) {
    last_logging_time = now
    influx.writePoints(
      [
        {
          measurement: measurement_name,
          tags: {
            unit: "A",
          },
          fields: {
            phase_1: Number(current_sample.phase_1),
            phase_2: Number(current_sample.phase_2),
            total: Number(current_sample.phase_1) + Number(current_sample.phase_2),
          },
          timestamp: new Date(),
        }
      ], {
        database: DB_name,
        precision: 's',
      })
      .then( () => {console.log(`[InfluxDB] Measurement saved`)})
      .catch(error => { console.error(`[InfluxDB] Error saving data to InfluxDB! ${error}`) });
  }





});


io.on('connection', (socket) =>{
  console.log('[WS] a user connected');


  socket.on('get_current_consumption', () => {
    socket.emit('current_consumption', current_sample)
  })
});
