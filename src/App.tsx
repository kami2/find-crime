import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import DeckGL from '@deck.gl/react/typed';
import { IconLayer } from '@deck.gl/layers/typed';
import type { IconLayerProps } from '@deck.gl/layers/typed';
import Map from 'react-map-gl';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// --- Constants ---

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

const CRIME_COLORS: { [key: string]: [number, number, number] } = {
  'anti-social-behaviour': [241, 196, 15],
  'bicycle-theft': [26, 188, 156],
  'burglary': [52, 152, 219],
  'criminal-damage-arson': [230, 126, 34],
  'drugs': [46, 204, 113],
  'other-theft': [149, 165, 166],
  'possession-of-weapons': [155, 89, 182],
  'public-order': [231, 76, 60],
  'robbery': [192, 57, 43],
  'shoplifting': [52, 73, 94],
  'theft-from-the-person': [243, 156, 18],
  'vehicle-crime': [211, 84, 0],
  'violent-crime': [142, 68, 173],
  'other-crime': [127, 140, 141]
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

const currentDate = new Date();
const currentYearNum = currentDate.getFullYear();
const currentMonthNum = currentDate.getMonth() + 1;

const YEARS = Array.from({ length: 6 }, (_, i) => currentYearNum - i); 

const MAP_STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const MAP_STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

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

const formatPrettyDate = (dateStr: string) => {
  if (!dateStr) return '';
  const [year, month] = dateStr.split('-');
  const monthLabel = MONTHS.find(m => m.value === month)?.label || month;
  return `${monthLabel} ${year}`;
};

const getPolygonString = (lat: number, lng: number) => {
  const latOffset = 0.045; 
  const lngOffset = 0.075;

  const p1 = `${lat + latOffset},${lng - lngOffset}`;
  const p2 = `${lat + latOffset},${lng + lngOffset}`;
  const p3 = `${lat - latOffset},${lng + lngOffset}`;
  const p4 = `${lat - latOffset},${lng - lngOffset}`;

  return `${p1}:${p2}:${p3}:${p4}`;
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

interface Suggestion {
  display_name: string;
  lat: string;
  lon: string;
}

function App() {
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [data, setData] = useState<CrimePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('Bristol');
  
  const [selectedYear, setSelectedYear] = useState(currentYearNum.toString());
  const [selectedMonth, setSelectedMonth] = useState('01');
  
  const [errorMsg, setErrorMsg] = useState('');
  const [visibleCategories, setVisibleCategories] = useState<{ [key: string]: boolean }>({});
  const [darkMode, setDarkMode] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(window.innerWidth > 768);
  const [showSearchHere, setShowSearchHere] = useState(false);

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const availableMonths = useMemo(() => {
    if (parseInt(selectedYear) === currentYearNum) {
      return MONTHS.filter(m => parseInt(m.value) <= currentMonthNum);
    }
    return MONTHS;
  }, [selectedYear]);

  useEffect(() => {
    if (parseInt(selectedYear) === currentYearNum && parseInt(selectedMonth) > currentMonthNum) {
      setSelectedMonth(currentMonthNum.toString().padStart(2, '0'));
    }
  }, [selectedYear, selectedMonth]);

  const fetchCrimes = useCallback(async (lat: number, lng: number, year: string, month: string, retries = 6) => {
    setLoading(true);
    setErrorMsg('');
    setShowSearchHere(false);
    
    const dateStr = `${year}-${month}`;

    const processResults = async (results: ApiCrimeData[]) => {
      if (results.length === 0 && retries > 0) {
        console.log(`Empty data for ${dateStr}, trying previous month...`);
        const prev = getPreviousMonth(year, month);
        await fetchCrimes(lat, lng, prev.year, prev.month, retries - 1);
        return;
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
    };

    try {
      const poly = getPolygonString(lat, lng);
      let url = `https://data.police.uk/api/crimes-street/all-crime?poly=${poly}&date=${dateStr}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        if (response.status === 503) {
           console.log("Polygon search failed, falling back to point search...");
           url = `https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}&date=${dateStr}`;
           const fallbackResponse = await fetch(url);
           if (!fallbackResponse.ok) {
             setErrorMsg('Failed to fetch crime data (fallback)');
             setData([]);
             setVisibleCategories({});
             return;
           }
           const fallbackResults = await fallbackResponse.json();
           await processResults(fallbackResults);
           return;
        }

        if ((response.status === 404 || response.status === 422) && retries > 0) {
          console.log(`No data for ${dateStr}, trying previous month...`);
          const prev = getPreviousMonth(year, month);
          await fetchCrimes(lat, lng, prev.year, prev.month, retries - 1);
          return;
        }
        setErrorMsg('Failed to fetch crime data');
        setData([]);
        setVisibleCategories({});
        return;
      }

      const results = await response.json();
      await processResults(results);

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
    fetchCrimes(INITIAL_VIEW_STATE.latitude, INITIAL_VIEW_STATE.longitude, selectedYear, selectedMonth).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  // Autocomplete logic
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);

    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }

    if (value.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceTimeout.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(value)}&countrycodes=gb&limit=5`
        );
        const data = await response.json();
        setSuggestions(data);
        setShowSuggestions(true);
      } catch (err) {
        console.error("Autocomplete error:", err);
      }
    }, 300);
  };

  const handleSuggestionClick = (suggestion: Suggestion) => {
    setSearchQuery(suggestion.display_name.split(',')[0]); 
    setSuggestions([]);
    setShowSuggestions(false);
    
    const lat = parseFloat(suggestion.lat);
    const lon = parseFloat(suggestion.lon);

    setViewState(prev => ({
      ...prev,
      latitude: lat,
      longitude: lon,
      zoom: 13,
      transitionDuration: 1000
    } as any));

    fetchCrimes(lat, lon, selectedYear, selectedMonth).catch(console.error);
    
    if (window.innerWidth <= 768) {
      setIsMenuOpen(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowSuggestions(false);
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

        setViewState(prev => ({
          ...prev,
          latitude: lat,
          longitude: lon,
          zoom: 13,
          transitionDuration: 1000
        } as any));

        await fetchCrimes(lat, lon, selectedYear, selectedMonth);
        
        if (window.innerWidth <= 768) {
          setIsMenuOpen(false);
        }
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

  const handleSearchHere = () => {
    fetchCrimes(viewState.latitude, viewState.longitude, selectedYear, selectedMonth).catch(console.error);
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
    } as IconLayerProps<CrimePoint>) // Explicitly cast props to avoid IDE warnings
  ];

  const availableCategories = Object.keys(visibleCategories).sort();
  const areAllSelected = availableCategories.length > 0 && availableCategories.every(cat => visibleCategories[cat]);

  const panelStyle = {
    position: 'absolute' as 'absolute', 
    top: 20, 
    left: 20, 
    width: 'min(320px, 90vw)', 
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

  const fabStyle = {
    position: 'absolute' as 'absolute',
    top: 20,
    left: 20,
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    background: darkMode ? '#222' : 'white',
    color: darkMode ? 'white' : 'black',
    border: `1px solid ${darkMode ? '#444' : '#ccc'}`,
    boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
    cursor: 'pointer',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    transition: 'background 0.3s, color 0.3s'
  };

  const searchHereStyle = {
    position: 'absolute' as 'absolute',
    top: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '10px 20px',
    borderRadius: '20px',
    background: darkMode ? '#222' : 'white',
    color: darkMode ? 'white' : 'black',
    border: `1px solid ${darkMode ? '#444' : '#ccc'}`,
    boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
    cursor: 'pointer',
    zIndex: 900,
    fontWeight: 'bold' as 'bold',
    fontSize: '14px',
    transition: 'opacity 0.3s',
    opacity: showSearchHere ? 1 : 0,
    pointerEvents: showSearchHere ? 'auto' as 'auto' : 'none' as 'none'
  };

  const suggestionsStyle = {
    position: 'absolute' as 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    background: darkMode ? '#333' : 'white',
    border: `1px solid ${darkMode ? '#444' : '#ccc'}`,
    borderRadius: '4px',
    marginTop: '2px',
    zIndex: 1001,
    maxHeight: '200px',
    overflowY: 'auto' as 'auto',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
  };

  const suggestionItemStyle = {
    padding: '8px 12px',
    cursor: 'pointer',
    borderBottom: `1px solid ${darkMode ? '#444' : '#eee'}`,
    fontSize: '13px',
    color: darkMode ? '#eee' : '#333'
  };

  return (
    <div id="deckgl-wrapper" style={{ position: 'relative', width: '100vw', height: '100vh', background: darkMode ? '#111' : '#ddd' }}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState }: any) => {
          setViewState(viewState);
          setShowSearchHere(true);
        }}
        controller={true}
        layers={layers}
        getTooltip={getTooltip}
        style={{ width: '100%', height: '100%' }}
      >
        <Map
          mapLib={(maplibregl as any).default || maplibregl}
          mapStyle={darkMode ? MAP_STYLE_DARK : MAP_STYLE_LIGHT}
          renderWorldCopies={true} 
        />
      </DeckGL>
      
      <button style={searchHereStyle} onClick={handleSearchHere}>
        Search in this area
      </button>

      {!isMenuOpen && (
        <button style={fabStyle} onClick={() => setIsMenuOpen(true)} title="Open Menu">
          ☰
        </button>
      )}

      {isMenuOpen && (
        <div style={panelStyle}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
              <button 
                onClick={() => setIsMenuOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: darkMode ? '#eee' : '#333',
                  cursor: 'pointer',
                  fontSize: '18px',
                  padding: '0',
                  display: 'flex',
                  alignItems: 'center'
                }}
                title="Close Menu"
              >
                ✕
              </button>
              <h2 style={{margin: 0, fontSize: '18px'}}>UK Crime Map</h2>
            </div>
            
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
              {darkMode ? '☀️' : '🌙'}
            </button>
          </div>
          
          <form onSubmit={handleSearch} style={{display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '15px'}}>
            <div style={{position: 'relative'}}>
              <label style={{fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '3px'}}>City:</label>
              <input 
                type="text" 
                value={searchQuery}
                onChange={handleInputChange}
                placeholder="Enter UK city"
                style={inputStyle}
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div style={suggestionsStyle}>
                  {suggestions.map((s, i) => (
                    <div 
                      key={i} 
                      style={suggestionItemStyle}
                      onClick={() => handleSuggestionClick(s)}
                      onMouseEnter={(e) => e.currentTarget.style.background = darkMode ? '#444' : '#f5f5f5'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      {s.display_name}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label style={{fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '3px'}}>Date:</label>
              <div style={{display: 'flex', gap: '5px'}}>
                <select 
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  style={{...inputStyle, flex: 1}}
                >
                  {availableMonths.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
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
      )}
    </div>
  );
}

export default App;