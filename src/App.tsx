import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DeckGL from '@deck.gl/react/typed';
import { IconLayer } from '@deck.gl/layers/typed';
import Map from 'react-map-gl';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// --- Constants ---

const UK_BOUNDS: [number, number, number, number] = [-9.0, 49.5, 2.5, 61.0];

// Bristol Coordinates
const INITIAL_VIEW_STATE = {
  longitude: -2.5879,
  latitude: 51.4545,
  zoom: 13,
  pitch: 0,
  bearing: 0
};

const ICON_URL = 'https://img.icons8.com/ios-filled/100/000000/marker.png';

const ICON_MAPPING = {
  marker: {
    x: 0, 
    y: 0, 
    width: 100, 
    height: 100, 
    mask: true,
    anchorY: 100 
  }
};

// New, muted color palette (pastel/professional)
const CRIME_COLORS: { [key: string]: [number, number, number] } = {
  'anti-social-behaviour': [241, 196, 15],  // Sunflower
  'bicycle-theft': [26, 188, 156],          // Turquoise
  'burglary': [52, 152, 219],               // Peter River
  'criminal-damage-arson': [230, 126, 34],  // Carrot
  'drugs': [46, 204, 113],                  // Emerald
  'other-theft': [149, 165, 166],           // Concrete
  'possession-of-weapons': [155, 89, 182],  // Amethyst
  'public-order': [231, 76, 60],            // Alizarin
  'robbery': [192, 57, 43],                 // Pomegranate
  'shoplifting': [52, 73, 94],              // Wet Asphalt
  'theft-from-the-person': [243, 156, 18],  // Orange
  'vehicle-crime': [211, 84, 0],            // Pumpkin
  'violent-crime': [142, 68, 173],          // Wisteria
  'other-crime': [127, 140, 141]            // Asbestos
};

const DEFAULT_COLOR: [number, number, number] = [100, 100, 100];

const MONTHS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' }
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => currentYear - i); 

// Map Styles
const MAP_STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const MAP_STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Helper: Calculate previous month
const getPreviousMonth = (yearStr: string, monthStr: string) => {
  let year = parseInt(yearStr);
  let month = parseInt(monthStr);
  
  month -= 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  
  return {
    year: year.toString(),
    month: month.toString().padStart(2, '0')
  };
};

// Helper to format date (2024-01 -> January 2024)
const formatPrettyDate = (dateStr: string) => {
  if (!dateStr) return '';
  const [year, month] = dateStr.split('-');
  const monthLabel = MONTHS.find(m => m.value === month)?.label || month;
  return `${monthLabel} ${year}`;
};

interface ApiCrimeData {
  id: number;
  category: string;
  location: {
    latitude: string;
    longitude: string;
    street: {
      name: string;
    };
  };
  month: string;
  outcome_status: {
    category: string;
    date: string;
  } | null;
}

interface CrimePoint {
  coordinates: [number, number];
  type: string;
  category: string;
  location: string;
  id: number;
  month: string;
  outcome: string;
  outcomeDate: string | null;
}

function App() {
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [data, setData] = useState<CrimePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('Bristol'); // Changed default city
  
  const [selectedYear, setSelectedYear] = useState(currentYear.toString());
  const [selectedMonth, setSelectedMonth] = useState('01');
  
  const [errorMsg, setErrorMsg] = useState('');
  const [visibleCategories, setVisibleCategories] = useState<{ [key: string]: boolean }>({});

  // Dark Mode State - Default: TRUE
  const [darkMode, setDarkMode] = useState(true);

  const handleViewStateChange = ({ viewState: newViewState }: any) => {
    const { longitude, latitude, zoom } = newViewState;
    let newLong = longitude;
    let newLat = latitude;

    if (newLong < UK_BOUNDS[0]) newLong = UK_BOUNDS[0];
    if (newLong > UK_BOUNDS[2]) newLong = UK_BOUNDS[2];
    if (newLat < UK_BOUNDS[1]) newLat = UK_BOUNDS[1];
    if (newLat > UK_BOUNDS[3]) newLat = UK_BOUNDS[3];

    setViewState({
      ...newViewState,
      longitude: newLong,
      latitude: newLat,
      zoom: Math.max(zoom, 6) 
    });
  };

  const fetchCrimes = useCallback(async (lat: number, lng: number, year: string, month: string, retries = 6) => {
    setLoading(true);
    setErrorMsg('');
    
    const dateStr = `${year}-${month}`;

    try {
      let url = `https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}&date=${dateStr}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        // If 404 or 422 (no data/bad date) and we have retries -> try previous month
        if ((response.status === 404 || response.status === 422) && retries > 0) {
          console.log(`No data for ${dateStr}, trying previous month...`);
          const prev = getPreviousMonth(year, month);
          return fetchCrimes(lat, lng, prev.year, prev.month, retries - 1);
        }
        
        // Handle error directly instead of throwing locally
        setErrorMsg('Failed to fetch crime data');
        setData([]);
        setVisibleCategories({});
        return;
      }

      const results: ApiCrimeData[] = await response.json();
      
      // If array is empty (sometimes API returns 200 OK but [] for future dates), try previous month
      if (results.length === 0 && retries > 0) {
        console.log(`Empty data for ${dateStr}, trying previous month...`);
        const prev = getPreviousMonth(year, month);
        return fetchCrimes(lat, lng, prev.year, prev.month, retries - 1);
      }

      const formattedData: CrimePoint[] = results.map(crime => ({
        coordinates: [parseFloat(crime.location.longitude), parseFloat(crime.location.latitude)],
        type: crime.category.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        category: crime.category,
        location: crime.location.street.name,
        id: crime.id,
        month: crime.month,
        outcome: crime.outcome_status ? crime.outcome_status.category : (crime.category === 'anti-social-behaviour' ? 'N/A' : 'Status unknown'),
        outcomeDate: crime.outcome_status ? crime.outcome_status.date : null
      }));

      setData(formattedData);
      
      // Update dropdowns to the date where data was ACTUALLY found
      setSelectedYear(year);
      setSelectedMonth(month);

      const categories = Array.from(new Set(formattedData.map(d => d.category)));
      const initialVisibility: { [key: string]: boolean } = {};
      categories.forEach(cat => {
        initialVisibility[cat] = true;
      });
      setVisibleCategories(initialVisibility);

      if (formattedData.length === 0) {
        setErrorMsg('No crimes found in this area (checked last 6 months).');
      }
    } catch (error: any) {
      console.error(error);
      setErrorMsg(error.message || 'Error loading data.');
      setData([]); 
      setVisibleCategories({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Start with selected (current) year/month
    fetchCrimes(INITIAL_VIEW_STATE.latitude, INITIAL_VIEW_STATE.longitude, selectedYear, selectedMonth).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    setErrorMsg('');

    try {
      const geoResponse = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&countrycodes=gb`
      );
      const geoData = await geoResponse.json();

      if (geoData && geoData.length > 0) {
        const lat = parseFloat(geoData[0].lat);
        const lon = parseFloat(geoData[0].lon);

        if (lat < UK_BOUNDS[1] || lat > UK_BOUNDS[3] || lon < UK_BOUNDS[0] || lon > UK_BOUNDS[2]) {
             setErrorMsg('Location seems to be outside the UK.');
             setLoading(false);
             return;
        }

        setViewState(prev => ({
          ...prev,
          latitude: lat,
          longitude: lon,
          zoom: 13,
          transitionDuration: 1000
        } as any));

        // Also use retry logic on search
        await fetchCrimes(lat, lon, selectedYear, selectedMonth);
      } else {
        setErrorMsg('City not found in the UK.');
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Geocoding error.');
      setLoading(false);
    }
  };

  const toggleCategory = (category: string) => {
    setVisibleCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  const toggleAllCategories = () => {
    const allSelected = Object.values(visibleCategories).every(v => v);
    const newState: { [key: string]: boolean } = {};
    
    Object.keys(visibleCategories).forEach(key => {
      newState[key] = !allSelected; 
    });
    
    setVisibleCategories(newState);
  };

  const filteredData = useMemo(() => {
    return data.filter(d => visibleCategories[d.category]);
  }, [data, visibleCategories]);

  const getTooltip = ({ object }: any) => {
    if (!object) return null;
    
    const color = CRIME_COLORS[object.category] || DEFAULT_COLOR;
    const colorHex = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    const prettyDate = formatPrettyDate(object.month);
    const prettyOutcomeDate = object.outcomeDate ? formatPrettyDate(object.outcomeDate) : null;

    return {
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 13px; min-width: 200px;">
          <div style="
            margin: -10px -10px 10px -10px; 
            padding: 10px; 
            background-color: ${colorHex}; 
            color: white; 
            font-weight: bold;
            border-radius: 8px 8px 0 0;
            text-shadow: 0 1px 2px rgba(0,0,0,0.3);
          ">
            ${object.type}
          </div>
          
          <div style="margin-bottom: 8px;">
            <strong style="color: #888; font-size: 11px; text-transform: uppercase;">Location</strong><br/>
            ${object.location}
          </div>
          
          <div style="margin-bottom: 8px;">
            <strong style="color: #888; font-size: 11px; text-transform: uppercase;">Date Reported</strong><br/>
            ${prettyDate}
          </div>

          ${object.outcome !== 'N/A' ? `
            <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid #444;">
              <strong style="color: #888; font-size: 11px; text-transform: uppercase;">Investigation Status</strong><br/>
              <span style="color: #ddd;">${object.outcome}</span>
              ${prettyOutcomeDate ? `<br/><span style="font-size: 11px; color: #aaa;">(Updated: ${prettyOutcomeDate})</span>` : ''}
            </div>
          ` : ''}
        </div>
      `,
      style: {
        backgroundColor: '#1a1a1a',
        color: '#ffffff',
        padding: '10px',
        borderRadius: '8px',
        boxShadow: '0 8px 16px rgba(0,0,0,0.3)',
        maxWidth: '300px',
        border: '1px solid #333'
      }
    };
  };

  const layers = [
    new IconLayer<CrimePoint>({
      id: 'icon-layer',
      data: filteredData,
      pickable: true,
      iconAtlas: ICON_URL,
      iconMapping: ICON_MAPPING,
      getIcon: (_d: any) => 'marker',
      sizeScale: 1,
      getPosition: (d: any) => d.coordinates,
      getSize: (_d: any) => 48,
      getColor: (d: any) => CRIME_COLORS[d.category] || DEFAULT_COLOR,
      onHover: (info) => {
        const el = document.getElementById('deckgl-wrapper');
        if (el) {
          el.style.cursor = info.object ? 'pointer' : 'default';
        }
      }
    })
  ];

  const availableCategories = Object.keys(visibleCategories).sort();
  const areAllSelected = availableCategories.length > 0 && availableCategories.every(cat => visibleCategories[cat]);

  // Styles for Dark/Light mode
  const panelStyle = {
    position: 'absolute' as 'absolute', 
    top: 20, 
    left: 20, 
    width: '320px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column' as 'column',
    background: darkMode ? '#222' : 'white', 
    color: darkMode ? '#eee' : '#333',
    padding: '15px', 
    borderRadius: '8px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
    fontFamily: 'sans-serif',
    zIndex: 1000,
    transition: 'background 0.3s, color 0.3s'
  };

  const inputStyle = {
    width: '100%', 
    padding: '8px', 
    borderRadius: '4px', 
    border: `1px solid ${darkMode ? '#444' : '#ccc'}`, 
    boxSizing: 'border-box' as 'border-box',
    background: darkMode ? '#333' : 'white',
    color: darkMode ? 'white' : 'black'
  };

  return (
    <div id="deckgl-wrapper" style={{ position: 'relative', width: '100vw', height: '100vh', background: darkMode ? '#111' : '#ddd' }}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        controller={true}
        layers={layers}
        getTooltip={getTooltip}
        style={{ width: '100%', height: '100%' }}
      >
        <Map
          mapLib={maplibregl as any}
          mapStyle={darkMode ? MAP_STYLE_DARK : MAP_STYLE_LIGHT}
          maxBounds={UK_BOUNDS}
          minZoom={6}
          renderWorldCopies={false}
        />
      </DeckGL>
      
      {/* Sidebar / Controls */}
      <div style={panelStyle}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px'}}>
          <h2 style={{margin: 0, fontSize: '18px'}}>UK Crime Map</h2>
          <button 
            onClick={() => setDarkMode(!darkMode)}
            style={{
              background: 'transparent',
              border: `1px solid ${darkMode ? '#555' : '#ccc'}`,
              color: darkMode ? '#eee' : '#333',
              borderRadius: '4px',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            {darkMode ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
        
        <form onSubmit={handleSearch} style={{display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '15px'}}>
          <div>
            <label style={{fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '3px'}}>City:</label>
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Enter UK city"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={{fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '3px'}}>Date:</label>
            <div style={{display: 'flex', gap: '5px'}}>
              <select 
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                style={{...inputStyle, flex: 1}}
              >
                {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>

              <select 
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                style={{...inputStyle, flex: 1}}
              >
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          <button 
            type="submit" 
            style={{padding: '10px', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'}}
            disabled={loading}
          >
            {loading ? 'Searching...' : 'Search & Update'}
          </button>
        </form>

        {errorMsg && <div style={{color: 'red', fontSize: '12px', marginBottom: '10px'}}>{errorMsg}</div>}

        <div style={{fontSize: '12px', color: darkMode ? '#aaa' : '#666', marginBottom: '10px'}}>
          <strong>Incidents found:</strong> {filteredData.length} (Total: {data.length})
        </div>

        <div style={{
          flex: 1, 
          overflowY: 'auto', 
          borderTop: `1px solid ${darkMode ? '#444' : '#eee'}`, 
          paddingTop: '10px'
        }}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px'}}>
            <h3 style={{fontSize: '14px', margin: 0}}>Crime Categories</h3>
            {availableCategories.length > 0 && (
              <button 
                onClick={toggleAllCategories}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#007bff',
                  cursor: 'pointer',
                  fontSize: '11px',
                  padding: 0,
                  textDecoration: 'underline'
                }}
              >
                {areAllSelected ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>

          {availableCategories.length === 0 && !loading && <div style={{fontSize: '12px', color: '#999'}}>No categories available.</div>}
          
          {availableCategories.map(cat => {
            const color = CRIME_COLORS[cat] || DEFAULT_COLOR;
            const rgbString = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
            const label = cat.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

            return (
              <div key={cat} style={{display: 'flex', alignItems: 'center', marginBottom: '6px', fontSize: '12px'}}>
                <input 
                  type="checkbox" 
                  checked={visibleCategories[cat]} 
                  onChange={() => toggleCategory(cat)}
                  style={{marginRight: '8px', cursor: 'pointer'}}
                />
                <span style={{
                  display: 'inline-block', 
                  width: '12px', 
                  height: '12px', 
                  borderRadius: '50%', 
                  backgroundColor: rgbString,
                  marginRight: '8px'
                }}></span>
                <span>{label}</span>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}

export default App;