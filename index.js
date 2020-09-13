let points, mark;

const extractWindow = (rrs, window) => {
  let duration = 0
  let i = rrs.length - 1
  while (true) {
    if (i < 0) {
      return null
    }
    duration += rrs[i]
    if (duration >= window * 1000) {
      break
    }
    i--
  }
  return rrs.slice(i)
}

const sqr = x => x * x
const mean = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length
const max = xs => Math.max.apply(Math, xs)
const min = xs => Math.min.apply(Math, xs)
const sd = xs => {
  const av = mean(xs)
  const sum = xs.reduce((sum, x) => sum + sqr(x - av), 0)
  return Math.sqrt(sum / (xs.length - 1))
}
const deltas = xs => {
  const ds = []
  for (let i = 1; i < xs.length; i++) {
    ds.push(xs[i] - xs[i - 1])
  }
  return ds
}
const nn = (xs, ms) => deltas(xs).filter(d => d > ms).length

const features = {
  nn20: rrs => nn(rrs, 20),
  pnn20: rrs => nn(rrs, 20) / rrs.length,
  nn50: rrs => nn(rrs, 50),
  pnn50: rrs => nn(rrs, 50) / rrs.length,
  sdnn: rrs => sd(rrs),
  avnn: rrs => mean(rrs),
  sdsd: rrs => sd(deltas(rrs)),
  ebc: rrs => max(rrs) - min(rrs),
  rmssd: rrs => {
    const sum = deltas(rrs).reduce((sum, d) => sum + sqr(d), 0)
    return Math.sqrt(sum / rrs.length)
  }
}
const windows = [5, 10, 20, 40, 60, 90, 120, 180, 300]

const chartIds = ['heartRate', 'RR'].concat(Object.keys(features))

const addMarker = () => {
  mark = true
}
const handleHeartRate = (domElements, hr) => {
  if (mark) {
    mark = false
    chartIds.forEach(c => points[c][0].push(1))
  } else {
    chartIds.forEach(c => points[c][0].push(null))
  }
  console.log(points.RR[0])

  points.heartRate[1] = points.heartRate[1] || []
  points.heartRate[1].push(hr.heartRate)
  console.log('heart rate', hr.heartRate)

  points.RR[1] = points.RR[1] || []
  points.RR[1].push.apply(points.RR[1], hr.rrs)
  hr.rrs.forEach(rr => {
    console.log('rr', rr)
  })

  const featureNames = Object.keys(features)
  windows.forEach((window, i) => {
    const windowIndex = i + 1
    const rrs = extractWindow(points.RR[1], window)
    if (rrs === null) {
      featureNames.forEach(feature => {
        points[feature][windowIndex] = points[feature][windowIndex] || []
        points[feature][windowIndex].push(null)
      })
      return
    }
    featureNames.forEach(feature => {
      const value = features[feature](rrs)
      points[feature][windowIndex] = points[feature][windowIndex] || []
      points[feature][windowIndex].push(value)
      console.log(window + 's feature', feature, value)
    })
  })
  redraw(domElements)
}

const decode = (data) => {
  // ported from https://github.com/polarofficial/polar-ble-sdk/blob/master/sources/Android/android-communications/src/main/java/com/androidcommunications/polar/api/ble/model/gatt/client/BleHrClient.java
  let cumulative_rr = 0
  const hrFormat = data[0] & 0x01
  const sensorContact = ((data[0] & 0x06) >> 1) === 3
  const contactSupported = !((data[0] & 0x06) === 0)
  const energyExpended = (data[0] & 0x08) >> 3
  const rrPresent = ((data[0] & 0x10) >> 4) === 1
  const polar_32bit_rr = (data[0] & 0x20) >> 5
  const heartRate = (hrFormat === 1 ? (data[1] + (data[2] << 8)) : data[1]) & (hrFormat === 1 ? 0x0000FFFF : 0x000000FF)
  let offset = hrFormat + 2
  let energy = 0
  if (energyExpended === 1) {
    energy = (data[offset] & 0xFF) + ((data[offset + 1] & 0xFF) << 8)
    offset += 2
  }
  const rrs = []
  if (rrPresent) {
    while (offset < data.length) {
      const rrValue = ((data[offset] & 0xFF) + ((data[offset + 1] & 0xFF) << 8))
      offset += 2;
      rrs.push(rrValue);
    }
  } else if (polar_32bit_rr == 1 && (offset + 3) < data.length) {
    cumulative_rr = ((data[offset] & 0xFF) + ((data[offset + 1] & 0xFF) << 8) + ((data[offset + 2] & 0xFF) << 16) + ((data[offset + 3] & 0xFF) << 24))
  }
  const finalCumulative_rr = cumulative_rr;
  const finalEnergy = energy;
  return {
    heartRate, sensorContact, energy: finalEnergy, rrs, contactSupported, cumulativeRR: finalCumulative_rr, rrPresent
  }
}

const start = async (domElements) => {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{services: ['heart_rate']}]
  })
  console.log(device)
  const server = await device.gatt.connect()
  console.log(server)
  const service = await server.getPrimaryService('heart_rate')
  console.log(service)
  const characteristic = await service.getCharacteristic('heart_rate_measurement')
  console.log(characteristic)

  characteristic.addEventListener('characteristicvaluechanged', () => handleHeartRate(domElements, decode(new Uint8Array(characteristic.value.buffer))))
  points = chartIds.reduce((c, cid) => {
    c[cid] = [[]]
    return c
  }, {})
  mark = false

  characteristic.startNotifications()
  return () => characteristic.stopNotifications()
}

const markerSeries = (s, value) => {
  return s.map(s => s === null ? null : value)
}

const redraw = (domElements) => {
  chartIds.forEach(chartId => {
    if (points[chartId].length === 0) {
      return
    }
    drawChart(domElements[chartId], points[chartId])
  })
}

const drawChart = (domElement, series) => {
  const minimum = min(series.slice(1).map(min))
var data = {
  // A labels array that can contain any sort of values
  labels: Object.keys(series[0]),
  // Our series array that contains series objects or in this case series data arrays
  series: series.map((s, index) => ({name:`series${index}`, data: index === 0 ? markerSeries(s, minimum) : s}))
};

var options = {
  plugins: [
    window['Chartist.plugins.ctMarker']({
      series: ['series0']
    })
  ],
  // Don't draw the line chart points
  showPoint: false,
  // Disable line smoothing
  lineSmooth: false,
  // X-Axis specific configuration
  axisX: {
    // We can disable the grid for this axis
    showGrid: true,
    // and also don't show the label
    showLabel: false
  },
  // Y-Axis specific configuration
  axisY: {
    type: Chartist.AutoScaleAxis,
    // Lets offset the chart a bit from the labels
    offset: 60,
    // The label interpolation function enables you to modify the values
    // used for the labels on each axis. Here we are converting the
    // values into million pound.
    labelInterpolationFnc: function(value) {
      return value;
    }
  }
};
// Create a new line chart object where as first parameter we pass in a selector
// that is resolving to our chart container element. The Second parameter
// is the actual data object.
new Chartist.Line(domElement, data, options);

}

const main = async () => {
  console.log('load')
  const app = document.querySelector('.app')

  const button = document.createElement('button')
  button.appendChild(document.createTextNode('start'))
  app.appendChild(button)
  let stop
  button.addEventListener('click', async () => {
    stop = await start(domElements)
  }, false)

  const stopButton = document.createElement('button')
  stopButton.appendChild(document.createTextNode('stop'))
  app.appendChild(stopButton)
  stopButton.addEventListener('click', () => stop(), false)

  const serializedData = document.createElement('textarea')
  const loadButton = document.createElement('button')
  loadButton.appendChild(document.createTextNode('load'))
  loadButton.addEventListener('click', () => {
    points = JSON.parse(serializedData.value)
    redraw(domElements)
  }, false)
  const saveButton = document.createElement('button')
  saveButton.appendChild(document.createTextNode('save'))
  saveButton.addEventListener('click', () => {
    serializedData.value = JSON.stringify(points)
  }, false)
  app.appendChild(saveButton)
  app.appendChild(loadButton)
  app.appendChild(serializedData)

  const windowsElement = document.createElement('div')
  windowsElement.className = 'legend noselect'
  app.appendChild(windowsElement)
  windows.forEach((window, i) => {
    const label = document.createElement('span')
    label.className = `label-${String.fromCharCode(i + 97 + 1)}`
    label.appendChild(document.createTextNode(`${window}s`))
    windowsElement.appendChild(label)
  })

  const domElements = {}
  chartIds.forEach(chartId => {
    const header = document.createElement('h2')
    header.className = 'noselect'
    header.appendChild(document.createTextNode(chartId))
    header.addEventListener('click', () => element.scrollIntoView({block:'end'}), false)
    app.appendChild(header)

    const element = document.createElement('div')
    element.addEventListener('click', () => addMarker(), false)
    element.className = 'chart'
    app.appendChild(element)
    domElements[chartId] = element
  })
}

main().catch(err => console.log(err.stack))
