import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "./index.css";

const C = 3e8; // speed of light m/s
const toHz = (ghz) => ghz * 1e9;
const wavelength = (ghz) => C / toHz(ghz); // λ = c/f

export default function App() {
  let mapRef = useRef(null);
  let svgRef = useRef(null);

  let [map, setMap] = useState(null);

  let [towers, setTowers] = useState([]); 
  let [links, setLinks] = useState([]); 
   let [selected, setSelected] = useState(null); 
 let [pendingLinkStart, setPendingLinkStart] = useState(null);
  let [idSeq, setIdSeq] = useState(1);

  
  useEffect(() => {
  if (!mapRef.current) return;
  const m = L.map(mapRef.current).setView([20.5937, 78.9629], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(m);
  setMap(m);

  return () => {
    m.remove(); 
  };
}, []);


 
  const syncSvgSize = () => {
    if (!map || !svgRef.current || !mapRef.current) return;
    const rect = mapRef.current.getBoundingClientRect();
    svgRef.current.setAttribute("width", rect.width);
    svgRef.current.setAttribute("height", rect.height);
    svgRef.current.innerHTML = "";
    links.forEach((l) => {
      if (l.fresnelVisible) drawFresnelEllipse(l);
    });
  };

  useEffect(() => {
    if (!map) return;
    syncSvgSize();
    map.on("zoomend", syncSvgSize);
    map.on("moveend", syncSvgSize);
    window.addEventListener("resize", syncSvgSize);
    return () => {
      map.off("zoomend", syncSvgSize);
      map.off("moveend", syncSvgSize);
      window.removeEventListener("resize", syncSvgSize);
    };
   
  }, [map, links]);

  // add tower on map click
  useEffect(() => {
    if (!map) return;
    const onClick = (e) => addTower(e.latlng);
    map.on("click", onClick);
    return () => map.off("click", onClick);
   
  }, [map, idSeq, towers]);

  function addTower(latlng) {
    const id = idSeq;
    const marker = L.circleMarker(latlng, {
      radius: 8,
      color: "#3b82f6",
      fillColor: "#3b82f6",
      fillOpacity: 0.9,
    }).addTo(map);
    marker.bindTooltip(`Tower #${id} — 5 GHz`);
    marker.on("click", (ev) => {
      L.DomEvent.stopPropagation(ev);
      handleTowerClick(id);
    });

    const t = { id, latlng, freqGHz: 5, marker };
    setTowers((prev) => [...prev, t]);
    setIdSeq((prev) => prev + 1);
  }

  function handleTowerClick(id) {
    const t = towers.find((x) => x.id === id);
    if (pendingLinkStart == null) {
      setPendingLinkStart(id);
      setSelected({ type: "tower", id });
      return;
    }
    const a = towers.find((x) => x.id === pendingLinkStart);
    const b = t;
    if (!a || a.id === b.id) return;
    if (a.freqGHz !== b.freqGHz) {
      setPendingLinkStart(null);
      return;
    }
    createLink(a.id, b.id);
    setPendingLinkStart(null);
  }

  function createLink(aId, bId) {
    const a = towers.find((t) => t.id === aId);
    const b = towers.find((t) => t.id === bId);
    const polyline = L.polyline([a.latlng, b.latlng], {
      color: "#93c5fd",
      weight: 3,
    }).addTo(map);
    const id = idSeq;
    const link = { id, aId, bId, polyline, fresnelVisible: false };
    polyline.on("click", (ev) => {
      L.DomEvent.stopPropagation(ev);
      setSelected({ type: "link", id });
    });
    setLinks((prev) => [...prev, link]);
    setIdSeq((prev) => prev + 1);
  }

  function deleteTower(id) {
    const t = towers.find((x) => x.id === id);
    if (!t) return;
    map.removeLayer(t.marker);


    // Remove linked links
    links.forEach((l) => {
      if (l.aId === id || l.bId === id) {
        map.removeLayer(l.polyline);
      }
    });
    setLinks((prev) => prev.filter((l) => l.aId !== id && l.bId !== id));
    setTowers((prev) => prev.filter((x) => x.id !== id));
    setSelected(null);
    clearFresnel();
  }

  function deleteLink(id) {
    const l = links.find((x) => x.id === id);
    if (!l) return;
    map.removeLayer(l.polyline);
    setLinks((prev) => prev.filter((x) => x.id !== id));
    setSelected(null);
    clearFresnel();
  }

  function updateTowerFreq(id, newFreqGHz) {
    setTowers((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        t.freqGHz = newFreqGHz;
        t.marker.bindTooltip(`Tower #${t.id} — ${t.freqGHz} GHz`);
        return { ...t };
      })
    );
  }

  function toggleFresnel(id) {
    setLinks((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, fresnelVisible: !l.fresnelVisible };
        if (next.fresnelVisible) drawFresnelEllipse(next);
        else clearFresnel();
        return next;
      })
    );
  }

  function clearFresnel() {
    if (!svgRef.current) return;
    svgRef.current.innerHTML = "";
  }

  function metersPerPixelAtLat(lat, zoom) {
    const earthCirc = 40075016.686;
    const latRad = (lat * Math.PI) / 180;
    return (earthCirc * Math.cos(latRad)) / Math.pow(2, zoom + 8);
  }

  function drawFresnelEllipse(link) {
    if (!map || !svgRef.current) return;

    clearFresnel();

    const a = towers.find((t) => t.id === link.aId)?.latlng;
    const b = towers.find((t) => t.id === link.bId)?.latlng;
    const freqGHz = towers.find((t) => t.id === link.aId)?.freqGHz;

    if (!a || !b || !freqGHz) return;
    const λ = wavelength(freqGHz);

    const mid = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
    const dTotal = map.distance(a, b);
    const d1 = map.distance(a, mid);
    const d2 = map.distance(mid, b);

    const rMid = Math.sqrt((λ * d1 * d2) / (d1 + d2)); // meters

    const pA = map.latLngToLayerPoint(a);
    const pB = map.latLngToLayerPoint(b);
    const pMid = map.latLngToLayerPoint(mid);

    const pxLength = Math.hypot(pB.x - pA.x, pB.y - pA.y);
    const mPerPixel = metersPerPixelAtLat(mid.lat, map.getZoom());
    const rPixels = rMid / mPerPixel;

    const cx = pMid.x;
    const cy = pMid.y;
    const rx = pxLength / 2;
    const ry = rPixels;

    const angleDeg = (Math.atan2(pB.y - pA.y, pB.x - pA.x) * 180) / Math.PI;

    const svg = svgRef.current;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `rotate(${angleDeg} ${cx} ${cy})`);

    const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
    ellipse.setAttribute("cx", cx);
    ellipse.setAttribute("cy", cy);
    ellipse.setAttribute("rx", rx);
    ellipse.setAttribute("ry", ry);
    ellipse.setAttribute("fill", "#3b82f6");
    ellipse.setAttribute("fill-opacity", "0.15");
    ellipse.setAttribute("stroke", "#2563eb");
    ellipse.setAttribute("stroke-width", "2");

    g.appendChild(ellipse);
    svg.appendChild(g);
  }

  
let selectedTower = selected?.type === "tower" ? towers.find((t) => t.id === selected.id) : null;
  let selectedLink = selected?.type === "link" ? links.find((l) => l.id === selected.id) : null;

  return (
    <div className="app" style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: "100vh" }}>
      <aside
        className="sidebar"
        style={{ padding: 16, borderRight: "1px solid #e5e7eb", background: "#f9fafb", overflowY: "auto" }}
      >
        <h2 style={{ marginTop: 0 }}>Controls</h2>
        <div style={{ fontSize: 14, color: "#6b7280", display: "grid", gap: 6 }}>
          <span>Click map to add tower</span>
          <span>Click a tower, then another with same frequency to link</span>
          <span>Click a link to toggle Fresnel</span>
        </div>

        <div style={{ marginTop: 16 }}>
          <h3>Selection</h3>
          {!selected && <div style={{ color: "#6b7280" }}>Nothing selected.</div>}
          {selectedTower && (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ color: "#374151" }}>
                Tower #{selectedTower.id} — {selectedTower.freqGHz} GHz
              </div>
              <label>Frequency (GHz)</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={selectedTower.freqGHz}
                onChange={(e) => updateTowerFreq(selectedTower.id, parseFloat(e.target.value))}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setPendingLinkStart(selectedTower.id)}>Start link</button>
                <button onClick={() => deleteTower(selectedTower.id)} style={{ background: "#ef4444", color: "white" }}>
                  Delete tower
                </button>
              </div>
            </div>
          )}
          {selectedLink && (
            <div style={{ display: "grid", gap: 8 }}>
              <div>Link #{selectedLink.id}</div>
              <div style={{ color: "#6b7280" }}>
                Frequency: {towers.find((t) => t.id === selectedLink.aId)?.freqGHz} GHz — Distance:{" "}
                {(map?.distance(
                  towers.find((t) => t.id === selectedLink.aId)?.latlng,
                  towers.find((t) => t.id === selectedLink.bId)?.latlng
                ) / 1000).toFixed(2)}{" "}
                km
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => toggleFresnel(selectedLink.id)}>
                  {selectedLink.fresnelVisible ? "Hide Fresnel" : "Show Fresnel"}
                </button>
                <button onClick={() => deleteLink(selectedLink.id)} style={{ background: "#ef4444", color: "white" }}>
                  Delete link
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <h3>Towers</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {towers.map((t) => (
              <div key={t.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>#{t.id}</div>
                  <div>{t.freqGHz} GHz</div>
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Lat: {t.latlng.lat.toFixed(4)}, Lng: {t.latlng.lng.toFixed(4)}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setPendingLinkStart(t.id)}>Start link</button>
                  <button onClick={() => setSelected({ type: "tower", id: t.id })}>Select</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <h3>Links</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {links.map((l) => {
              const a = towers.find((t) => t.id === l.aId);
              const b = towers.find((t) => t.id === l.bId);
              const distKm = a && b && map ? (map.distance(a.latlng, b.latlng) / 1000).toFixed(2) : "—";
              return (
                <div key={l.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>#{l.id}</div>
                    <div>{a?.freqGHz} GHz</div>
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>Distance: {distKm} km</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setSelected({ type: "link", id: l.id })}>Select</button>
                    <button onClick={() => toggleFresnel(l.id)}>{l.fresnelVisible ? "Hide" : "Show"} Fresnel</button>
                    <button onClick={() => deleteLink(l.id)} style={{ background: "#ef4444", color: "white" }}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      <main style={{ position: "relative" }}>
        <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
        <svg ref={svgRef} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }} />
      </main>
    </div>
  );
}
