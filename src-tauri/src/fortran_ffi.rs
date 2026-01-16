//! FFI bindings to Fortran RBMK physics library
//! 
//! This module provides safe Rust wrappers around the Fortran physics calculations.
//! The Fortran code is compiled to a DLL and loaded dynamically at runtime.

use std::sync::OnceLock;
use libloading::{Library, Symbol};

/// Global library handle
static FORTRAN_LIB: OnceLock<Library> = OnceLock::new();

/// Type definitions for Fortran function signatures
type CalculateNeutronFlux = unsafe extern "C" fn(
    n_points: i32,
    dz: f64,
    flux: *mut f64,
    k_eff: *mut f64,
);

type CalculateReactivity = unsafe extern "C" fn(
    k_eff: f64,
    fuel_temp: f64,
    coolant_void: f64,
    xe_concentration: f64,
    graphite_temp: f64,
    reactivity: *mut f64,
);

type SolvePointKinetics = unsafe extern "C" fn(
    n_neutrons: f64,
    precursors: f64,
    reactivity: f64,
    dt: f64,
    n_new: *mut f64,
    precursors_new: *mut f64,
);

type CalculateXenonDynamics = unsafe extern "C" fn(
    iodine: f64,
    xenon: f64,
    neutron_flux: f64,
    dt: f64,
    iodine_new: *mut f64,
    xenon_new: *mut f64,
);

type CalculateThermalPower = unsafe extern "C" fn(
    n_neutrons: f64,
    n_nominal: f64,
    power_mw: *mut f64,
);

type CalculateRodWorth = unsafe extern "C" fn(
    rod_position: f64,
    max_worth: f64,
    worth: *mut f64,
);

type SimulateScram = unsafe extern "C" fn(
    time_since_scram: f64,
    total_rod_worth: f64,
    reactivity_inserted: *mut f64,
);

/// Initialize the Fortran library
fn get_library() -> &'static Library {
    FORTRAN_LIB.get_or_init(|| {
        // Try multiple locations for the DLL
        let dll_paths = [
            // Build output directory (set by build.rs)
            std::env::var("RBMK_DLL_PATH").ok(),
            // Current executable directory
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.join("rbmk_physics.dll").to_string_lossy().into_owned())),
            // Current working directory
            Some("rbmk_physics.dll".to_string()),
            // src-tauri directory
            Some("src-tauri/rbmk_physics.dll".to_string()),
            // Target debug directory
            Some("target/debug/rbmk_physics.dll".to_string()),
        ];
        
        for path in dll_paths.iter().flatten() {
            if let Ok(lib) = unsafe { Library::new(path) } {
                println!("Loaded Fortran library from: {}", path);
                return lib;
            }
        }
        
        panic!("Failed to load rbmk_physics.dll! Make sure gfortran is installed and the DLL was built.");
    })
}

/// Calculate neutron flux distribution using one-group diffusion equation
/// 
/// # Arguments
/// * `n_points` - Number of axial mesh points
/// * `dz` - Mesh spacing [cm]
/// 
/// # Returns
/// * Tuple of (flux distribution, k_effective)
pub fn calc_neutron_flux(n_points: usize, dz: f64) -> (Vec<f64>, f64) {
    let lib = get_library();
    let mut flux = vec![0.0f64; n_points];
    let mut k_eff: f64 = 1.0;
    
    unsafe {
        let func: Symbol<CalculateNeutronFlux> = lib
            .get(b"calculate_neutron_flux")
            .expect("Failed to load calculate_neutron_flux");
        
        func(
            n_points as i32,
            dz,
            flux.as_mut_ptr(),
            &mut k_eff,
        );
    }
    
    (flux, k_eff)
}

/// Calculate total reactivity with all feedback effects
/// 
/// # Arguments
/// * `k_eff` - Effective multiplication factor
/// * `fuel_temp` - Average fuel temperature [K]
/// * `coolant_void` - Average coolant void fraction [%]
/// * `xe_concentration` - Xenon-135 concentration [atoms/cm³]
/// * `graphite_temp` - Average graphite temperature [K]
/// 
/// # Returns
/// * Total reactivity [Δk/k]
pub fn calc_reactivity(
    k_eff: f64,
    fuel_temp: f64,
    coolant_void: f64,
    xe_concentration: f64,
    graphite_temp: f64,
) -> f64 {
    let lib = get_library();
    let mut reactivity: f64 = 0.0;
    
    unsafe {
        let func: Symbol<CalculateReactivity> = lib
            .get(b"calculate_reactivity")
            .expect("Failed to load calculate_reactivity");
        
        func(
            k_eff,
            fuel_temp,
            coolant_void,
            xe_concentration,
            graphite_temp,
            &mut reactivity,
        );
    }
    
    reactivity
}

/// Solve point kinetics equations for one time step
/// 
/// # Arguments
/// * `n_neutrons` - Current neutron population
/// * `precursors` - Current delayed neutron precursor concentration
/// * `reactivity` - Current reactivity [Δk/k]
/// * `dt` - Time step [s]
/// 
/// # Returns
/// * Tuple of (new neutron population, new precursor concentration)
pub fn solve_kinetics(
    n_neutrons: f64,
    precursors: f64,
    reactivity: f64,
    dt: f64,
) -> (f64, f64) {
    let lib = get_library();
    let mut n_new: f64 = 0.0;
    let mut c_new: f64 = 0.0;
    
    unsafe {
        let func: Symbol<SolvePointKinetics> = lib
            .get(b"solve_point_kinetics")
            .expect("Failed to load solve_point_kinetics");
        
        func(
            n_neutrons,
            precursors,
            reactivity,
            dt,
            &mut n_new,
            &mut c_new,
        );
    }
    
    (n_new, c_new)
}

/// Calculate xenon and iodine dynamics
/// 
/// # Arguments
/// * `iodine` - Current I-135 concentration [atoms/cm³]
/// * `xenon` - Current Xe-135 concentration [atoms/cm³]
/// * `neutron_flux` - Average neutron flux [n/cm²/s]
/// * `dt` - Time step [s]
/// 
/// # Returns
/// * Tuple of (new iodine concentration, new xenon concentration)
pub fn calc_xenon(
    iodine: f64,
    xenon: f64,
    neutron_flux: f64,
    dt: f64,
) -> (f64, f64) {
    let lib = get_library();
    let mut i_new: f64 = 0.0;
    let mut xe_new: f64 = 0.0;
    
    unsafe {
        let func: Symbol<CalculateXenonDynamics> = lib
            .get(b"calculate_xenon_dynamics")
            .expect("Failed to load calculate_xenon_dynamics");
        
        func(
            iodine,
            xenon,
            neutron_flux,
            dt,
            &mut i_new,
            &mut xe_new,
        );
    }
    
    (i_new, xe_new)
}

/// Calculate thermal power from neutron population
/// 
/// # Arguments
/// * `n_neutrons` - Current neutron population
/// * `n_nominal` - Nominal neutron population (at 100% power)
/// 
/// # Returns
/// * Thermal power [MW]
pub fn calc_power(n_neutrons: f64, n_nominal: f64) -> f64 {
    let lib = get_library();
    let mut power: f64 = 0.0;
    
    unsafe {
        let func: Symbol<CalculateThermalPower> = lib
            .get(b"calculate_thermal_power")
            .expect("Failed to load calculate_thermal_power");
        
        func(n_neutrons, n_nominal, &mut power);
    }
    
    power
}

/// Calculate control rod worth based on position
/// 
/// # Arguments
/// * `rod_position` - Rod position (0.0 = fully inserted, 1.0 = fully withdrawn)
/// * `max_worth` - Maximum rod worth [Δk/k]
/// 
/// # Returns
/// * Current rod worth [Δk/k]
pub fn calc_rod_worth(rod_position: f64, max_worth: f64) -> f64 {
    let lib = get_library();
    let mut worth: f64 = 0.0;
    
    unsafe {
        let func: Symbol<CalculateRodWorth> = lib
            .get(b"calculate_rod_worth")
            .expect("Failed to load calculate_rod_worth");
        
        func(rod_position, max_worth, &mut worth);
    }
    
    worth
}

/// Simulate emergency SCRAM reactivity insertion
/// 
/// # Arguments
/// * `time_since_scram` - Time since SCRAM initiation [s]
/// * `total_rod_worth` - Total worth of all SCRAM rods [Δk/k]
/// 
/// # Returns
/// * Reactivity inserted (negative) [Δk/k]
pub fn sim_scram(time_since_scram: f64, total_rod_worth: f64) -> f64 {
    let lib = get_library();
    let mut reactivity: f64 = 0.0;
    
    unsafe {
        let func: Symbol<SimulateScram> = lib
            .get(b"simulate_scram")
            .expect("Failed to load simulate_scram");
        
        func(time_since_scram, total_rod_worth, &mut reactivity);
    }
    
    reactivity
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_neutron_flux() {
        let (flux, k_eff) = calc_neutron_flux(50, 14.0);
        assert_eq!(flux.len(), 50);
        assert!(k_eff > 0.0);
    }
    
    #[test]
    fn test_reactivity() {
        let rho = calc_reactivity(1.0, 800.0, 0.0, 1e15, 600.0);
        // At k_eff = 1.0, base reactivity should be 0
        assert!(rho.abs() < 0.1);
    }
    
    #[test]
    fn test_kinetics() {
        let (n, c) = solve_kinetics(1.0, 0.0065, 0.0, 0.1);
        // At zero reactivity, neutron population should be stable
        assert!((n - 1.0).abs() < 0.1);
    }
}
