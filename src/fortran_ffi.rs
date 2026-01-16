//! FFI bindings to Fortran RBMK physics module
//! 
//! This module provides safe Rust wrappers around the Fortran functions
//! for nuclear physics calculations.

use std::os::raw::c_double;
use std::os::raw::c_int;

// External Fortran functions (C-compatible interface)
extern "C" {
    /// Calculate neutron flux distribution using one-group diffusion equation
    fn calculate_neutron_flux(
        n_points: c_int,
        dz: c_double,
        flux: *mut c_double,
        k_eff: *mut c_double,
    );

    /// Calculate reactivity with temperature and xenon feedback
    fn calculate_reactivity(
        k_eff: c_double,
        fuel_temp: c_double,
        coolant_void: c_double,
        xe_concentration: c_double,
        graphite_temp: c_double,
        reactivity: *mut c_double,
    );

    /// Solve point kinetics equations
    fn solve_point_kinetics(
        n_neutrons: c_double,
        precursors: c_double,
        reactivity: c_double,
        dt: c_double,
        n_new: *mut c_double,
        precursors_new: *mut c_double,
    );

    /// Calculate xenon dynamics (I-135 and Xe-135)
    fn calculate_xenon_dynamics(
        iodine: c_double,
        xenon: c_double,
        neutron_flux: c_double,
        dt: c_double,
        iodine_new: *mut c_double,
        xenon_new: *mut c_double,
    );

    /// Calculate thermal power from neutron population
    fn calculate_thermal_power(
        n_neutrons: c_double,
        n_nominal: c_double,
        power_mw: *mut c_double,
    );

    /// Calculate control rod worth
    fn calculate_rod_worth(
        rod_position: c_double,
        max_worth: c_double,
        worth: *mut c_double,
    );

    /// Simulate emergency SCRAM
    fn simulate_scram(
        time_since_scram: c_double,
        total_rod_worth: c_double,
        reactivity_inserted: *mut c_double,
    );
}

/// Safe wrapper for neutron flux calculation
/// 
/// # Arguments
/// * `n_points` - Number of spatial points
/// * `dz` - Spatial step size [cm]
/// 
/// # Returns
/// Tuple of (flux distribution, k_effective)
pub fn calc_neutron_flux(n_points: usize, dz: f64) -> (Vec<f64>, f64) {
    let mut flux = vec![0.0f64; n_points];
    let mut k_eff: f64 = 0.0;
    
    unsafe {
        calculate_neutron_flux(
            n_points as c_int,
            dz,
            flux.as_mut_ptr(),
            &mut k_eff,
        );
    }
    
    (flux, k_eff)
}

/// Safe wrapper for reactivity calculation
/// 
/// # Arguments
/// * `k_eff` - Effective multiplication factor
/// * `fuel_temp` - Fuel temperature [K]
/// * `coolant_void` - Coolant void fraction [%]
/// * `xe_concentration` - Xenon-135 concentration [atoms/cm³]
/// * `graphite_temp` - Graphite temperature [K]
/// 
/// # Returns
/// Total reactivity [Δk/k]
pub fn calc_reactivity(
    k_eff: f64,
    fuel_temp: f64,
    coolant_void: f64,
    xe_concentration: f64,
    graphite_temp: f64,
) -> f64 {
    let mut reactivity: f64 = 0.0;
    
    unsafe {
        calculate_reactivity(
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

/// Safe wrapper for point kinetics solver
/// 
/// # Arguments
/// * `n_neutrons` - Current neutron population
/// * `precursors` - Delayed neutron precursor concentration
/// * `reactivity` - Current reactivity [Δk/k]
/// * `dt` - Time step [s]
/// 
/// # Returns
/// Tuple of (new neutron population, new precursor concentration)
pub fn solve_kinetics(
    n_neutrons: f64,
    precursors: f64,
    reactivity: f64,
    dt: f64,
) -> (f64, f64) {
    let mut n_new: f64 = 0.0;
    let mut precursors_new: f64 = 0.0;
    
    unsafe {
        solve_point_kinetics(
            n_neutrons,
            precursors,
            reactivity,
            dt,
            &mut n_new,
            &mut precursors_new,
        );
    }
    
    (n_new, precursors_new)
}

/// Safe wrapper for xenon dynamics calculation
/// 
/// # Arguments
/// * `iodine` - I-135 concentration [atoms/cm³]
/// * `xenon` - Xe-135 concentration [atoms/cm³]
/// * `neutron_flux` - Neutron flux [n/cm²/s]
/// * `dt` - Time step [s]
/// 
/// # Returns
/// Tuple of (new I-135 concentration, new Xe-135 concentration)
pub fn calc_xenon(
    iodine: f64,
    xenon: f64,
    neutron_flux: f64,
    dt: f64,
) -> (f64, f64) {
    let mut iodine_new: f64 = 0.0;
    let mut xenon_new: f64 = 0.0;
    
    unsafe {
        calculate_xenon_dynamics(
            iodine,
            xenon,
            neutron_flux,
            dt,
            &mut iodine_new,
            &mut xenon_new,
        );
    }
    
    (iodine_new, xenon_new)
}

/// Safe wrapper for thermal power calculation
/// 
/// # Arguments
/// * `n_neutrons` - Current neutron population
/// * `n_nominal` - Nominal neutron population
/// 
/// # Returns
/// Thermal power [MW]
pub fn calc_power(n_neutrons: f64, n_nominal: f64) -> f64 {
    let mut power: f64 = 0.0;
    
    unsafe {
        calculate_thermal_power(n_neutrons, n_nominal, &mut power);
    }
    
    power
}

/// Safe wrapper for control rod worth calculation
/// 
/// # Arguments
/// * `rod_position` - Rod position (0.0 = fully inserted, 1.0 = fully withdrawn)
/// * `max_worth` - Maximum rod worth [Δk/k]
/// 
/// # Returns
/// Current rod worth [Δk/k]
pub fn calc_rod_worth(rod_position: f64, max_worth: f64) -> f64 {
    let mut worth: f64 = 0.0;
    
    unsafe {
        calculate_rod_worth(rod_position, max_worth, &mut worth);
    }
    
    worth
}

/// Safe wrapper for SCRAM simulation
/// 
/// # Arguments
/// * `time_since_scram` - Time since SCRAM initiation [s]
/// * `total_rod_worth` - Total control rod worth [Δk/k]
/// 
/// # Returns
/// Reactivity inserted by SCRAM [Δk/k]
pub fn sim_scram(time_since_scram: f64, total_rod_worth: f64) -> f64 {
    let mut reactivity: f64 = 0.0;
    
    unsafe {
        simulate_scram(time_since_scram, total_rod_worth, &mut reactivity);
    }
    
    reactivity
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_neutron_flux() {
        let (flux, k_eff) = calc_neutron_flux(50, 14.0);
        assert!(k_eff > 0.0);
        assert!(flux.iter().all(|&x| x >= 0.0));
    }

    #[test]
    fn test_reactivity() {
        let rho = calc_reactivity(1.0, 800.0, 0.0, 0.0, 600.0);
        // At k_eff = 1.0, base reactivity should be 0
        assert!(rho.abs() < 0.1);
    }

    #[test]
    fn test_rod_worth() {
        let worth_inserted = calc_rod_worth(0.0, 0.05);
        let worth_withdrawn = calc_rod_worth(1.0, 0.05);
        
        // Fully inserted should have max worth
        assert!(worth_inserted > worth_withdrawn);
    }
}
