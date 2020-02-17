const Influx = require('influx');
const path = require('path');
const express = require('express');
const history = require('connect-history-api-fallback');
const bodyParser = require("body-parser");
const http = require('http');
const mqtt = require('mqtt');
const cors = require('cors');

const secrets = require('./secrets.js');

const DB_name = 'current_consumption'

const app = express();
app.use(cors())
//const influx = new Influx.InfluxDB('http://localhost:8086/' + DB_name)
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


const PORT = 7667




app.get('/data', (req, res) => {
  influx.query(`
    select * from current
  `)
  .then( result => res.send(result) )
  .catch( error => res.status(500) );
})

app.get('/drop', (req, res) => {
  influx.dropDatabase(DB_name)
  .then( () => {
    influx.getDatabaseNames()
    .then(names => {
      if (!names.includes(DB_name)) {
        influx.createDatabase(DB_name)
        .then(() => {
          influx.query(`CREATE RETENTION POLICY "renention_policy" ON "${DB_name}" DURATION 1h REPLICATION 1 DEFAULT`)
          .then( result => res.send('OK') )
          .catch( error =>  res.status(500).send(error) );
        })
        .catch( error =>  res.status(500).send(error) );
      }
    })
    .catch(error => res.status(500).send(error));
  })
  .catch(error => res.status(500).send(error));
})

app.listen(PORT, () => console.log(`[Express] Current consumption listening on 0.0.0.0:${PORT}`))


mqtt_client.on('connect', () => {
  console.log("[MQTT] Connected to MQTT broker")
  mqtt_client.subscribe("power/status");
});

mqtt_client.on('message', (topic, payload) => {
  console.log("[MQTT] Message arrived on " + topic)

  influx.writePoints(
    [
      {
        measurement: 'current',
        tags: {
          unit: "A",
        },
        fields: {
          phase_1: Number(JSON.parse(payload).phase_1),
          phase_2: Number(JSON.parse(payload).phase_2),
          total: Number(JSON.parse(payload).total),
        },
        timestamp: new Date(),
      }
    ], {
      database: DB_name,
      precision: 's',
    })
    .catch(error => {
      console.error(`Error saving data to InfluxDB! ${error}`)
    });
});
