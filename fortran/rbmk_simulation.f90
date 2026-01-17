! =============================================================================
! RBMK Simulation Module
! Main simulation step that combines all physics modules
! =============================================================================

module rbmk_simulation
    use iso_c_binding
    use rbmk_constants
    use rbmk_kinetics
    use rbmk_reactivity
    use rbmk_thermal
    use rbmk_xenon
    use rbmk_neutronics
    use rbmk_safety
    implicit none
    
    ! Module-level storage for 6-group precursor concentrations
    ! These persist between simulation steps
    real(c_double), save :: precursors_6_state(NUM_DELAYED_GROUPS) = 0.0d0
    logical, save :: precursors_initialized = .false.
    
contains

    ! =========================================================================
    ! Perform one complete simulation step with 6-group kinetics
    ! This is the main entry point called from Rust
    ! =========================================================================
    subroutine simulation_step( &
        ! Time parameters
        dt, &
        ! Input state
        neutron_population, precursors, &
        fuel_temp, coolant_temp, graphite_temp, coolant_void, &
        iodine_135, xenon_135, &
        total_rod_worth, smoothed_reactivity, &
        scram_active, &
        ! Output state
        neutron_population_new, precursors_new, &
        fuel_temp_new, coolant_temp_new, graphite_temp_new, coolant_void_new, &
        iodine_new, xenon_new, &
        reactivity_new, k_eff_new, &
        power_mw, power_percent, period, &
        explosion_severity, alert_flags &
    ) bind(C, name="simulation_step")
        
        ! Time step
        real(c_double), intent(in), value :: dt
        
        ! Input state
        real(c_double), intent(in), value :: neutron_population
        real(c_double), intent(in), value :: precursors
        real(c_double), intent(in), value :: fuel_temp
        real(c_double), intent(in), value :: coolant_temp
        real(c_double), intent(in), value :: graphite_temp
        real(c_double), intent(in), value :: coolant_void
        real(c_double), intent(in), value :: iodine_135
        real(c_double), intent(in), value :: xenon_135
        real(c_double), intent(in), value :: total_rod_worth
        real(c_double), intent(in), value :: smoothed_reactivity
        integer(c_int), intent(in), value :: scram_active
        
        ! Output state
        real(c_double), intent(out) :: neutron_population_new
        real(c_double), intent(out) :: precursors_new
        real(c_double), intent(out) :: fuel_temp_new
        real(c_double), intent(out) :: coolant_temp_new
        real(c_double), intent(out) :: graphite_temp_new
        real(c_double), intent(out) :: coolant_void_new
        real(c_double), intent(out) :: iodine_new
        real(c_double), intent(out) :: xenon_new
        real(c_double), intent(out) :: reactivity_new
        real(c_double), intent(out) :: k_eff_new
        real(c_double), intent(out) :: power_mw
        real(c_double), intent(out) :: power_percent
        real(c_double), intent(out) :: period
        real(c_double), intent(out) :: explosion_severity
        integer(c_int), intent(out) :: alert_flags
        
        ! Local variables
        real(c_double) :: avg_flux, dn_dt_actual, reactivity_dollars
        real(c_double) :: fuel_temp_kinetics
        real(c_double) :: precursors_6_new(NUM_DELAYED_GROUPS)
        real(c_double) :: source_term
        
        ! Initialize 6-group precursors on first call or if reset
        if (.not. precursors_initialized .or. precursors < 1.0d-10) then
            call init_precursors_6group(neutron_population, precursors_6_state)
            precursors_initialized = .true.
        end if
        
        ! Step 1: Calculate total reactivity with all feedback effects
        call calculate_total_reactivity( &
            fuel_temp, graphite_temp, coolant_void, &
            xenon_135, total_rod_worth, smoothed_reactivity, &
            dt, scram_active, reactivity_new)
        
        ! Step 2: Calculate k_eff from reactivity
        if (abs(reactivity_new) < 0.99d0) then
            k_eff_new = 1.0d0 / (1.0d0 - reactivity_new)
        else
            if (reactivity_new > 0.0d0) then
                k_eff_new = 100.0d0
            else
                k_eff_new = 0.01d0
            end if
        end if
        
        ! Step 3: Solve point kinetics with 6-group RK4
        ! External source term (for subcritical startup)
        source_term = 0.0d0
        if (neutron_population < 1.0d-4) then
            source_term = 1.0d-8  ! Small neutron source for startup
        end if
        
        call solve_point_kinetics_6group( &
            neutron_population, precursors_6_state, fuel_temp, reactivity_new, &
            source_term, dt, &
            neutron_population_new, precursors_6_new, fuel_temp_kinetics)
        
        ! Update stored 6-group precursors
        precursors_6_state = precursors_6_new
        
        ! Calculate total precursors for output (sum of all 6 groups)
        call sum_precursors_6group(precursors_6_new, precursors_new)
        
        ! Step 4: Calculate power
        call calculate_thermal_power(neutron_population_new, 1.0d0, power_mw)
        power_percent = max(power_mw / NOMINAL_POWER * 100.0d0, 0.0d0)
        
        ! Step 5: Update temperatures
        call update_temperatures( &
            power_percent, fuel_temp_kinetics, coolant_temp, graphite_temp, coolant_void, dt, &
            fuel_temp_new, coolant_temp_new, graphite_temp_new, coolant_void_new)
        
        ! Step 6: Update xenon dynamics
        ! Flux should be proportional to actual power, not just neutron population
        ! At zero power, there should be no fission and no xenon/iodine production
        ! Only use flux if power is above minimum threshold (0.1% = 3.2 MW)
        if (power_percent > 0.1d0) then
            avg_flux = neutron_population_new * 1.0d14
        else
            avg_flux = 0.0d0  ! No significant fission at very low power
        end if
        call calculate_xenon_dynamics( &
            iodine_135, xenon_135, avg_flux, dt, &
            iodine_new, xenon_new)
        
        ! Step 7: Calculate reactor period
        dn_dt_actual = (neutron_population_new - neutron_population) / dt
        if (neutron_population > 1.0d-10 .and. abs(dn_dt_actual) > 1.0d-10) then
            period = neutron_population / dn_dt_actual
            if (abs(period) > 1.0d6) then
                period = 1.0d30  ! Effectively infinity
            end if
        else
            period = 1.0d30  ! Effectively infinity
        end if
        
        ! Step 8: Check for explosion
        reactivity_dollars = reactivity_new / BETA_EFF
        call detect_explosion( &
            fuel_temp_new, coolant_temp_new, coolant_void_new, &
            reactivity_dollars, power_percent, &
            explosion_severity)
        
        ! Step 9: Check safety limits
        call check_safety_limits( &
            power_percent, reactivity_dollars, fuel_temp_new, &
            coolant_void_new, period, alert_flags)
        
    end subroutine simulation_step

    ! =========================================================================
    ! Get physical constants for Rust
    ! =========================================================================
    subroutine get_constants(beta_eff_out, neutron_lifetime_out, nominal_power_out) &
               bind(C, name="get_constants")
        real(c_double), intent(out) :: beta_eff_out
        real(c_double), intent(out) :: neutron_lifetime_out
        real(c_double), intent(out) :: nominal_power_out
        
        beta_eff_out = BETA_EFF
        neutron_lifetime_out = NEUTRON_LIFETIME
        nominal_power_out = NOMINAL_POWER
        
    end subroutine get_constants
    
    ! =========================================================================
    ! Reset 6-group precursor state (called when simulation is reset)
    ! =========================================================================
    subroutine reset_precursors_6group_state() bind(C, name="reset_precursors_6group_state")
        integer :: g
        
        do g = 1, NUM_DELAYED_GROUPS
            precursors_6_state(g) = 0.0d0
        end do
        precursors_initialized = .false.
        
    end subroutine reset_precursors_6group_state
    
    ! =========================================================================
    ! Get current 6-group precursor concentrations (for diagnostics/UI)
    ! =========================================================================
    subroutine get_precursors_6group(precursors_out) bind(C, name="get_precursors_6group")
        real(c_double), intent(out) :: precursors_out(NUM_DELAYED_GROUPS)
        
        precursors_out = precursors_6_state
        
    end subroutine get_precursors_6group

end module rbmk_simulation
