//! Tauri commands for RBMK reactor simulation
//!
//! These commands are exposed to the frontend via Tauri's IPC mechanism

use serde::{Deserialize, Serialize};
use tauri::State;
use std::sync::Arc;

use crate::reactor::{ReactorSimulator, ReactorState, ControlRod, FuelChannel, RodType, AutoRegulatorSettings};

/// Simulation state wrapper for Tauri
pub struct SimulatorState(pub Arc<ReactorSimulator>);

/// Response for simulation step
#[derive(Serialize, Deserialize)]
pub struct SimulationResponse {
    pub state: ReactorState,
    pub control_rods: Vec<ControlRod>,
}

/// Request to move control rods
#[derive(Serialize, Deserialize)]
pub struct MoveRodRequest {
    pub rod_id: Option<usize>,
    pub rod_type: Option<String>,
    pub position: f64,
}

/// Get current reactor state
#[tauri::command]
pub fn get_reactor_state(simulator: State<SimulatorState>) -> ReactorState {
    simulator.0.get_state()
}

/// Perform one simulation step
#[tauri::command]
pub fn simulation_step(simulator: State<SimulatorState>) -> SimulationResponse {
    simulator.0.step();
    SimulationResponse {
        state: simulator.0.get_state(),
        control_rods: simulator.0.get_control_rods(),
    }
}

/// Run multiple simulation steps (legacy, without time speed)
#[tauri::command]
pub fn simulation_run(simulator: State<SimulatorState>, steps: usize) -> SimulationResponse {
    for _ in 0..steps {
        simulator.0.step();
    }
    
    SimulationResponse {
        state: simulator.0.get_state(),
        control_rods: simulator.0.get_control_rods(),
    }
}

/// Accumulated simulation time for fractional steps
static ACCUMULATED_SIM_TIME: std::sync::Mutex<f64> = std::sync::Mutex::new(0.0);

/// Run real-time simulation
/// Takes delta_real_time (seconds since last call) and time_speed multiplier
/// Backend calculates how many physics steps to run based on these parameters
#[tauri::command(rename_all = "camelCase")]
pub fn simulation_realtime(
    simulator: State<SimulatorState>,
    delta_real_time: f64,
    time_speed: f64
) -> SimulationResponse {
    // Get current dt from state
    let dt = {
        let state = simulator.0.state.lock().unwrap();
        state.dt
    };
    
    // Calculate simulation time to advance
    // At time_speed=1, 1 second of real time = 1 second of simulation time
    // At time_speed=10, 1 second of real time = 10 seconds of simulation time
    let sim_time_delta = delta_real_time * time_speed;
    
    // Accumulate simulation time to handle fractional steps
    // This ensures that at low speeds we don't always run 1 step
    let mut accumulated = ACCUMULATED_SIM_TIME.lock().unwrap();
    *accumulated += sim_time_delta;
    
    // Calculate number of complete steps we can run
    let steps_to_run = (*accumulated / dt).floor() as usize;
    
    // Subtract the time we're about to simulate
    *accumulated -= (steps_to_run as f64) * dt;
    
    // Clamp to reasonable range
    let steps_to_run = steps_to_run.min(1000);
    
    // Run the physics steps
    for _ in 0..steps_to_run {
        simulator.0.step();
    }
    
    SimulationResponse {
        state: simulator.0.get_state(),
        control_rods: simulator.0.get_control_rods(),
    }
}

/// Initiate emergency SCRAM
#[tauri::command]
pub fn scram(simulator: State<SimulatorState>) -> ReactorState {
    simulator.0.scram();
    simulator.0.get_state()
}

/// Reset SCRAM
#[tauri::command]
pub fn reset_scram(simulator: State<SimulatorState>) -> ReactorState {
    simulator.0.reset_scram();
    simulator.0.get_state()
}

/// Move a single control rod
#[tauri::command]
pub fn move_control_rod(
    simulator: State<SimulatorState>,
    rod_id: usize,
    position: f64,
) -> Vec<ControlRod> {
    simulator.0.move_rod(rod_id, position);
    simulator.0.get_control_rods()
}

/// Move a group of control rods by type
#[tauri::command]
pub fn move_rod_group(
    simulator: State<SimulatorState>,
    rod_type: String,
    position: f64,
) -> Vec<ControlRod> {
    let rod_type = match rod_type.as_str() {
        "manual" => RodType::Manual,
        "automatic" => RodType::Automatic,
        "shortened" => RodType::Shortened,
        "emergency" => RodType::Emergency,
        _ => return simulator.0.get_control_rods(),
    };
    
    simulator.0.move_rod_group(rod_type, position);
    simulator.0.get_control_rods()
}

/// Get all control rod positions
#[tauri::command]
pub fn get_control_rods(simulator: State<SimulatorState>) -> Vec<ControlRod> {
    simulator.0.get_control_rods()
}

/// Get fuel channel data with synchronized parameters
/// All 1661 channels have the same parameters from global state (no diffusion coupling yet)
#[tauri::command]
pub fn get_fuel_channels(simulator: State<SimulatorState>) -> Vec<FuelChannel> {
    simulator.0.get_fuel_channels_synchronized()
}

/// Set simulation time step
#[tauri::command]
pub fn set_time_step(simulator: State<SimulatorState>, dt: f64) {
    let mut state = simulator.0.state.lock().unwrap();
    state.dt = dt.clamp(0.001, 1.0);
}

/// Reset simulation to initial state
#[tauri::command]
pub fn reset_simulation(simulator: State<SimulatorState>) -> ReactorState {
    simulator.0.reset();
    simulator.0.get_state()
}

// ============================================================================
// Automatic Regulator (AR/LAR) Commands
// ============================================================================

/// Enable or disable automatic power regulator (AR/LAR)
#[tauri::command]
pub fn set_auto_regulator_enabled(
    simulator: State<SimulatorState>,
    enabled: bool,
) -> AutoRegulatorSettings {
    simulator.0.set_auto_regulator_enabled(enabled);
    simulator.0.get_auto_regulator()
}

/// Set target power for automatic regulator
/// Target is in percent of nominal power (5-110%)
#[tauri::command]
pub fn set_target_power(
    simulator: State<SimulatorState>,
    target_percent: f64,
) -> AutoRegulatorSettings {
    simulator.0.set_target_power(target_percent);
    simulator.0.get_auto_regulator()
}

/// Get current automatic regulator settings
#[tauri::command]
pub fn get_auto_regulator(simulator: State<SimulatorState>) -> AutoRegulatorSettings {
    simulator.0.get_auto_regulator()
}

/// Get reactor parameters for 3D visualization
#[derive(Serialize)]
pub struct Reactor3DData {
    pub core_height: f64,
    pub core_radius: f64,
    pub fuel_channels: Vec<FuelChannel>,
    pub control_rods: Vec<ControlRod>,
    pub axial_flux: Vec<f64>,
    pub power_distribution: Vec<Vec<f64>>,
}

#[tauri::command]
pub fn get_3d_data(simulator: State<SimulatorState>) -> Reactor3DData {
    let state = simulator.0.get_state();
    let fuel_channels = simulator.0.get_fuel_channels_synchronized();
    let control_rods = simulator.0.get_control_rods();
    
    // Create simplified power distribution grid
    let grid_size = 20;
    let mut power_distribution = vec![vec![0.0; grid_size]; grid_size];
    
    for channel in &fuel_channels {
        let i = ((channel.x + 593.0) / 1186.0 * (grid_size as f64)) as usize;
        let j = ((channel.y + 593.0) / 1186.0 * (grid_size as f64)) as usize;
        
        if i < grid_size && j < grid_size {
            power_distribution[i][j] = channel.neutron_flux * state.power_percent / 100.0;
        }
    }
    
    Reactor3DData {
        core_height: 700.0,
        core_radius: 593.0,
        fuel_channels,
        control_rods,
        axial_flux: state.axial_flux,
        power_distribution,
    }
}
