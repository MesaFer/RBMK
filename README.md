# RBMK-1000 Reactor Simulator

A nuclear reactor physics simulation combining **Rust**, **Fortran**, **Tauri**, and **Babylon.js** for 3D visualization.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Babylon.js (WebGL)                           │
│                 3D Reactor Visualization                        │
├─────────────────────────────────────────────────────────────────┤
│                    TypeScript / HTML / CSS                      │
│                      Web Frontend (UI)                          │
├─────────────────────────────────────────────────────────────────┤
│                         Tauri IPC                               │
│                  (invoke commands from JS)                      │
├─────────────────────────────────────────────────────────────────┤
│                      Rust Backend                               │
│            - Reactor state management                           │
│            - Tauri commands                                     │
│            - FFI bindings to Fortran                            │
├─────────────────────────────────────────────────────────────────┤
│                    Fortran Module                               │
│            - Neutron diffusion solver                           │
│            - Point kinetics equations                           │
│            - Xenon dynamics                                     │
│            - Reactivity calculations                            │
└─────────────────────────────────────────────────────────────────┘
```

## Features

### Physics Simulation (Fortran)
- **Neutron Diffusion**: One-group diffusion equation with power iteration
- **Point Kinetics**: Time-dependent neutron population with delayed neutrons
- **Xenon Poisoning**: I-135 and Xe-135 dynamics
- **Reactivity Feedback**:
  - Fuel temperature (Doppler effect) - negative
  - Void coefficient - **positive** (RBMK characteristic!)
  - Graphite temperature - negative
- **Control Rod Worth**: S-curve insertion profile
- **SCRAM Simulation**: Emergency shutdown dynamics

### 3D Visualization (Babylon.js)
- Interactive 3D reactor core model
- Real-time power distribution display
- Control rod position visualization
- Cherenkov radiation glow effect
- Multiple camera views (3D, Top, Side)

### User Interface
- Real-time parameter display
- Control rod group sliders
- Axial flux distribution chart
- Alert system for safety limits
- Simulation speed control

## Prerequisites

### Windows
1. **Rust** (latest stable): https://rustup.rs/
2. **Node.js** (v18+): https://nodejs.org/
3. **gfortran** (MinGW-w64):
   ```cmd
   # Using Chocolatey
   choco install mingw
   
   # Or download from: https://winlibs.com/
   ```
4. **Tauri prerequisites**: https://tauri.app/v1/guides/getting-started/prerequisites

### Linux
```bash
# Ubuntu/Debian
sudo apt install gfortran build-essential libwebkit2gtk-4.0-dev \
    libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install gfortran webkit2gtk3-devel openssl-devel gtk3-devel \
    libappindicator-gtk3-devel librsvg2-devel
```

## Building

### 1. Install frontend dependencies
```bash
cd ui
npm install
cd ..
```

### 2. Build and run in development mode
```bash
cargo tauri dev
```

### 3. Build for production
```bash
cargo tauri build
```

## Project Structure

```
RBMK/
├── Cargo.toml              # Rust project configuration
├── build.rs                # Build script (compiles Fortran)
├── fortran/
│   └── rbmk_physics.f90    # Fortran physics module
├── src/
│   ├── main.rs             # Tauri application entry
│   ├── lib.rs              # Library exports
│   ├── fortran_ffi.rs      # Rust-Fortran FFI bindings
│   ├── reactor.rs          # Reactor state and simulation
│   └── commands.rs         # Tauri IPC commands
├── src-tauri/
│   └── tauri.conf.json     # Tauri configuration
└── ui/
    ├── package.json        # Node.js dependencies
    ├── index.html          # Main HTML page
    ├── vite.config.ts      # Vite bundler config
    └── src/
        ├── main.ts         # Frontend entry point
        └── visualization.ts # Babylon.js 3D renderer
```

## RBMK-1000 Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| Thermal Power | 3200 MW | Nominal thermal power |
| Fuel Channels | 1661 | Number of fuel assemblies |
| Core Height | 7 m | Active core height |
| Core Diameter | 11.8 m | Core diameter |
| Control Rods | 211 | Total control rods |
| β_eff | 0.0065 | Effective delayed neutron fraction |
| Void Coefficient | +2×10⁻⁴ Δk/k/% | **Positive!** |

## Safety Notes

⚠️ **This is a simplified educational simulation.** Real RBMK reactors have:
- Much more complex neutronics (multi-group, 3D)
- Detailed thermal-hydraulics
- Multiple safety systems
- Extensive instrumentation

The positive void coefficient is accurately modeled - this was a key factor in the Chernobyl accident.

## License

MIT License - Educational purposes only.

## References

1. INSAG-7: The Chernobyl Accident (IAEA, 1992)
2. RBMK Reactor Design Information (DOE/NE-0084)
3. Nuclear Reactor Physics (W.M. Stacey)
