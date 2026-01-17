//! RBMK Reactor Simulator - Main Entry Point
//! 
//! Tauri application for RBMK-1000 reactor simulation with 3D visualization

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use rbmk_simulator_lib::{ReactorSimulator, SimulatorState};
use rbmk_simulator_lib::commands::*;

fn main() {
    // Initialize logging
    env_logger::init();
    
    // Create reactor simulator
    let simulator = Arc::new(ReactorSimulator::new());
    
    // Build and run Tauri application
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SimulatorState(simulator))
        .invoke_handler(tauri::generate_handler![
            get_reactor_state,
            simulation_step,
            simulation_run,
            simulation_realtime,
            scram,
            reset_scram,
            move_control_rod,
            move_rod_group,
            move_rod_group_by_channel_type,
            move_control_rod_by_position,
            get_control_rods,
            get_fuel_channels,
            set_time_step,
            reset_simulation,
            get_3d_data,
            // Automatic regulator (AR/LAR) commands
            set_auto_regulator_enabled,
            set_target_power,
            get_auto_regulator,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running RBMK Simulator");
}
