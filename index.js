let points, times, mark, drawingPaused, windowRendered;

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
  avnn: rrs => mean(rrs) || null,
  sdsd: rrs => sd(deltas(rrs)),
  ebc: rrs => max(rrs) - min(rrs),
  rmssd: rrs => {
    const sum = deltas(rrs).reduce((sum, d) => sum + sqr(d), 0)
    return Math.sqrt(sum / rrs.length)
  }
}
const windows = [7.5, 15, 30, 60, 120, 240, 480]
windowRendered = windows.map(() => true)

const chartIds = ['heartRate', 'RR'].concat(Object.keys(features))

const addMarker = () => {
  mark = true
}
const handleHeartRate = (domElements, hr) => {
  times.push(new Date())
  if (mark) {
    mark = false
    chartIds.forEach(c => points[c][0].push(1))
  } else {
    chartIds.forEach(c => points[c][0].push(null))
  }

  points.heartRate[1] = points.heartRate[1] || []
  points.heartRate[1].push(hr.heartRate)

  points.RR[1] = points.RR[1] || []
  points.RR[1].push.apply(points.RR[1], hr.rrs)

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
  const server = await device.gatt.connect()
  const service = await server.getPrimaryService('heart_rate')
  const characteristic = await service.getCharacteristic('heart_rate_measurement')

  characteristic.addEventListener('characteristicvaluechanged', () => handleHeartRate(domElements, decode(new Uint8Array(characteristic.value.buffer))))
  points = chartIds.reduce((c, cid) => {
    c[cid] = [[]]
    return c
  }, {})
  times = []
  drawingPaused = false
  mark = false

  characteristic.startNotifications()
  return () => characteristic.stopNotifications()
}

const markerSeries = (s, value) => {
  return s.map(s => s === null ? null : value)
}

const redraw = (domElements) => {
  if (drawingPaused) {
    return
  }
  chartIds.forEach(chartId => {
    if (points[chartId].length === 0) {
      return
    }
    drawChart(domElements[chartId], points[chartId])
  })
}

const seriesColors = [
  'red',
  'red',
  '#6B8FFF',
  'purple',
  'gold',
  '#136F63',
  'lime',
  'darkorange'
]

const colors = window.matchMedia('(prefers-color-scheme: dark)').matches
  ? {fg: '#fff', bg: '#000'}
  : {fg: '#000', bg: '#fff'}

const drawChart = (domElement, series) => {
  const minimum = min(series.slice(1).map(min))
  const maximum = max(series.slice(1).map(max))
  let d = series.slice(1).flatMap((s, i) => !windowRendered[i] ? [] : [{
    x: times,
    y: s.slice(0),
    line: {color: seriesColors[i + 1]},
    name: ''
  }]).concat({
    line: {color: seriesColors[0]},
    name: '',
    x: series[0].flatMap((s, i) => s === null ? null : [times[i], times[i]]),
    y: series[0].flatMap(s => s === null ? null : [minimum, maximum]),
    mode: 'lines',
    connectgaps: false
  })
  const layout = {
    showlegend: false,
    paper_bgcolor: colors.bg,
    plot_bgcolor: colors.bg,
      yaxis: {
        color: colors.fg,
        fixedrange: true,
      },
      xaxis: {
        color: colors.fg,
        visible: false,
        range: [new Date(times[times.length - 1].getTime() - 10 * 60 * 1000), times[times.length - 1]]
      }
    }
  const opts = {
    margin: { r:0,l:0,b:0,autoexpand:true,pad:0,t: 0 },
    responsive: true
    }
  if (domElement.childNodes.length === 0) {
    Plotly.newPlot(domElement, d, layout, opts );
  } else {
    Plotly.react(domElement, d, layout, opts );
  }
}

const main = async () => {
  const app = document.querySelector('.app')

  const button = document.createElement('button')
  button.appendChild(document.createTextNode('start'))
  app.appendChild(button)
  let stop
  button.addEventListener('click', async () => {
    stop = await start(domElements)
  }, false)

  const pauseButton = document.createElement('button')
  pauseButton.appendChild(document.createTextNode('toggle pause'))
  app.appendChild(pauseButton)
  pauseButton.addEventListener('click', () => drawingPaused = !drawingPaused, false)

  const stopButton = document.createElement('button')
  stopButton.appendChild(document.createTextNode('stop'))
  app.appendChild(stopButton)
  stopButton.addEventListener('click', () => stop(), false)

  const serializedData = document.createElement('textarea')
  const loadButton = document.createElement('button')
  loadButton.appendChild(document.createTextNode('load'))
  loadButton.addEventListener('click', () => {
    const data = JSON.parse(serializedData.value)
    points = data.points
    times = data.times.map(t => new Date(t))
    redraw(domElements)
  }, false)
  const saveButton = document.createElement('button')
  saveButton.appendChild(document.createTextNode('save'))
  saveButton.addEventListener('click', () => {
    serializedData.value = JSON.stringify({times,points})
  }, false)
  app.appendChild(saveButton)
  app.appendChild(loadButton)
  app.appendChild(serializedData)

  const windowsElement = document.createElement('div')
  windowsElement.className = 'legend noselect'
  app.appendChild(windowsElement)
  windows.forEach((window, i) => {
    const label = document.createElement('span')
    label.addEventListener('click', () => {
      windowRendered[i] = !windowRendered[i]
      label.style.background = windowRendered[i] ? seriesColors[i + 1] : 'transparent'
      redraw(domElements)
    }, false)
    label.style.background = windowRendered[i] ? seriesColors[i + 1] : 'transparent'
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

main()
