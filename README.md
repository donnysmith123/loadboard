# Transmission Engineering Loadboard

A local web app for tracking project resource demand across your transmission engineering team.

## Requirements

- **Node.js** — download from https://nodejs.org (LTS version recommended)

## Setup (one time only)

1. Unzip this folder somewhere on your computer (e.g. `Documents/loadboard`)
2. Open **Terminal** (Mac) or **Command Prompt** (Windows)
3. Navigate to the folder:
   ```
   cd path/to/loadboard
   ```
4. Install dependencies:
   ```
   npm install
   ```

## Running the app

Every time you want to use the loadboard:

```
npm start
```

Then open your browser and go to: **http://localhost:3000**

To stop the app, press `Ctrl+C` in the terminal.

## Your data

All data is saved to `data/projects.json` in this folder.  
Back it up by copying that file anywhere you like.

## Features

- **Dashboard** — resource demand chart (expected vs worst-case) + discipline breakdown
- **Projects** — add/edit/delete projects with dates, probability, discipline, status, and monthly FTE inputs
- **Resource demand** — month-by-month table with visual demand bars and utilization %
- **Timeline** — Gantt chart with probability-based opacity
- **Settings** — set your team's total FTE capacity (shown as a reference line)
