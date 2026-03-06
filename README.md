#  AutoIntel – Intelligent Fleet Governance & Telemetry Platform

A modern **AI-powered fleet governance system** designed to monitor, analyze, and optimize vehicle operations in real time.

AutoIntel provides **real-time telemetry monitoring, intelligent alerts, vehicle health analytics, and predictive insights** to help organizations manage fleets efficiently.

Built with a **modern dashboard UI, real-time telemetry simulation, and data visualization**, the platform demonstrates how future **smart fleet management systems** will operate.

---

#  Problem Statement

Managing fleets across multiple vehicles and organizations is difficult because:

* Real-time vehicle visibility is limited
* Telemetry data is scattered or unavailable
* Predicting vehicle failures is difficult
* Unsafe driving behaviors go unnoticed
* Fleet efficiency is hard to measure

AutoIntel solves this by providing a **centralized intelligent platform for fleet governance and scheduling.**

---

#  Key Features

##  Basic Features (MVP)

###  Vehicle Management

* Register vehicles
* View vehicle list
* Vehicle status indicator

  * 🟢 Normal
  * 🟡 Warning
  * 🔴 Critical
* Vehicle information

  * Vehicle ID
  * Model
  * Type

---

###  Telemetry Data Simulation

Simulated real-time telemetry data including:

* Speed
* Engine Temperature
* Battery / Fuel Level
* GPS Location
* Timestamp

Telemetry is generated using a **Python-based simulator** and streamed to the dashboard.

---

###  Real-Time Fleet Dashboard

Dashboard overview displaying:

* Total Vehicles
* Active Vehicles
* Warning Vehicles
* Critical Vehicles

Includes **dynamic vehicle cards and live updates.**

---

###  Vehicle Cards

Each vehicle card shows:

* Current Speed
* Current Temperature
* Battery Level
* Last Update Time

This provides **instant visibility of fleet status.**

---

###  Data Visualization

Interactive charts display telemetry trends:

* Speed over time
* Temperature over time
* Battery level trends

Libraries used:

* **Recharts**
* **Chart.js**

---

###  Live Vehicle Map Tracking

Map view showing vehicle locations.

Features:

* Vehicle markers
* Popup with vehicle information
* Real-time position updates

Technologies:

* **Mapbox**
* **Leaflet**

---

#  Intermediate Features

These features introduce **data intelligence and analytics.**

---

##  Vehicle Health Score

Each vehicle receives a **health score based on telemetry analysis.**

Example formula:

```
Health Score = 100
               - overheating penalty
               - overspeed penalty
               - battery drop penalty
```

Example:

```
Vehicle V102
Health Score: 87
Status: Good
```

---

##  Intelligent Alert System

The system automatically triggers alerts when abnormal conditions occur.

| Condition              | Alert         |
| ---------------------- | ------------- |
| Speed > 120 km/h       | Overspeed     |
| Temperature > 90°C     | Overheating   |
| Battery < 15%          | Low Battery   |
| No data for 10 minutes | Telemetry Gap |

Example alert:

```
⚠ Overheating detected
Vehicle: V203
Temperature: 98°C
```

---

##  Driving Behaviour Score

Evaluates driver behavior using telemetry patterns.

Detects:

* Harsh braking
* Sudden acceleration
* Overspeeding

Example:

```
Driver Score: 82 / 100
Status: Safe Driving
```

---

##  Fleet Statistics

Fleet-wide analytics including:

* Average fleet speed
* Total distance travelled
* Average battery level
* Active vehicle percentage

---

##  Vehicle Detail Page

Each vehicle has a dedicated analytics page showing:

* Speed graph
* Temperature graph
* Battery graph
* Telemetry history table

---

##  Maintenance Logs

Track vehicle maintenance history.

Example:

```
Vehicle: V201
Last Service: 12 Feb
Next Service: 15 Apr
```

---

#  Advanced Features

These features simulate a **production-grade intelligent fleet platform.**

---

##  Fleet Efficiency Score

Measures overall fleet performance.

Formula:

```
Fleet Efficiency =
(vehicle health + energy efficiency + uptime) / 3
```

Example:

```
Fleet Efficiency: 91%
```

---

##  Telemetry Replay Timeline

Allows users to **replay historical vehicle movement.**

Example UI:

```
|----|----|----|----|
8AM  9AM  10AM 11AM
```

Vehicle path replays on the map.

---

##  Geofencing

Define authorized zones.

Example zones:

* Warehouse Zone
* Restricted Zone

Alert when vehicles leave defined zones.

```
⚠ Vehicle V302 left authorized area
```

---

##  Idle Vehicle Detection

Detects vehicles that are:

* Speed = 0
* Engine ON
* Time > 10 minutes

Alert example:

```
Vehicle idle for 12 minutes
```

---

##  Predictive Maintenance

Uses telemetry patterns to **predict potential failures.**

Predicts:

* Brake wear
* Battery failure
* Engine overheating risk

Example:

```
Maintenance Risk: HIGH
Suggested Service in 3 days
```

---

##  Fleet Performance Leaderboard

Ranks vehicles based on performance metrics.

Example:

```
#1 Vehicle V102
Efficiency: 94%

#2 Vehicle V208
Efficiency: 91%
```

---

#  System Architecture

AutoIntel uses a **modern IoT telemetry architecture**:

```
Vehicle Sensors
      ↓
Edge Processing
      ↓
Telemetry Stream
      ↓
Backend Processing
      ↓
Real-Time Dashboard
```

---

#  Tech Stack

### Frontend

* React
* Vite
* Tailwind CSS
* Recharts / Chart.js
* Mapbox / Leaflet

### Backend

* Node.js / Express

### Data Simulation

* Python Telemetry Simulator

### Realtime Communication

* WebSockets

---

#  Project Structure

```
AutoIntel
│
├── frontend
│   ├── dashboard
│   ├── vehicle-cards
│   ├── charts
│   └── maps
│
├── backend
│   ├── api
│   ├── telemetry
│   └── alerts
│
├── simulator
│   └── telemetry-simulator.py
│
└── README.md
```

---

#  Future Improvements

* AI anomaly detection
* Reinforcement learning fleet optimization
* Smart route planning
* Fuel efficiency prediction
* Integration with real OBD-II devices

---

#  Hackathon Impact

AutoIntel demonstrates how **AI + IoT + Real-time analytics** can transform fleet operations by:

* Improving safety
* Reducing downtime
* Increasing fleet efficiency
* Enabling predictive maintenance

---

#  Team

Developed during a **24-hour Hackathon** focused on **Fleet Governance & Scheduling Systems.**

