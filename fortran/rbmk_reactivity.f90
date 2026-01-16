! =============================================================================
! RBMK Reactivity Module
! Reactivity calculations with all feedback effects
! =============================================================================

module rbmk_reactivity
    use iso_c_binding
    use rbmk_constants
    implicit none
    
contains

    ! =========================================================================
    ! Calculate reactivity with temperature and xenon feedback
    ! rho = (k_eff - 1) / k_eff
    ! =========================================================================
    subroutine calculate_reactivity(k_eff, fuel_temp, coolant_void, xe_concentration, &
                                    graphite_temp, reactivity) bind(C, name="calculate_reactivity")
        real(c_double), intent(in), value :: k_eff
        real(c_double), intent(in), value :: fuel_temp        ! [K]
        real(c_double), intent(in), value :: coolant_void     ! [%]
        real(c_double), intent(in), value :: xe_concentration ! [atoms/cm^3]
        real(c_double), intent(in), value :: graphite_temp    ! [K]
        real(c_double), intent(out) :: reactivity
        
        real(c_double) :: rho_base, delta_rho_fuel, delta_rho_void
        real(c_double) :: delta_rho_xe, delta_rho_graphite
        
        ! Base reactivity from k_eff
        if (k_eff > 0.0d0) then
            rho_base = (k_eff - 1.0d0) / k_eff
        else
            rho_base = 0.0d0
        end if
        
        ! Fuel temperature feedback (Doppler effect - negative)
        delta_rho_fuel = ALPHA_FUEL * (fuel_temp - REF_FUEL_TEMP)
        
        ! Void coefficient feedback (POSITIVE in RBMK - this is the dangerous part!)
        delta_rho_void = ALPHA_VOID * coolant_void
        
        ! Xenon poisoning (negative reactivity)
        delta_rho_xe = -SIGMA_XE * xe_concentration * 1.0d-24  ! Convert to macroscopic
        
        ! Graphite temperature feedback (POSITIVE in RBMK)
        delta_rho_graphite = ALPHA_GRAPHITE * (graphite_temp - REF_GRAPHITE_TEMP)
        
        ! Total reactivity
        reactivity = rho_base + delta_rho_fuel + delta_rho_void + delta_rho_xe + delta_rho_graphite
        
    end subroutine calculate_reactivity

    ! =========================================================================
    ! Calculate total reactivity from all sources for simulation step
    ! This is the main reactivity calculation used in the simulation
    ! =========================================================================
    subroutine calculate_total_reactivity(fuel_temp, graphite_temp, coolant_void, &
                                          xenon_135, rod_worth, smoothed_reactivity, &
                                          dt, scram_active, new_reactivity) &
                                          bind(C, name="calculate_total_reactivity")
        real(c_double), intent(in), value :: fuel_temp        ! [K]
        real(c_double), intent(in), value :: graphite_temp    ! [K]
        real(c_double), intent(in), value :: coolant_void     ! [%]
        real(c_double), intent(in), value :: xenon_135        ! [atoms/cm^3]
        real(c_double), intent(in), value :: rod_worth        ! Total rod worth (positive value)
        real(c_double), intent(in), value :: smoothed_reactivity ! Previous smoothed reactivity
        real(c_double), intent(in), value :: dt               ! Time step [s]
        integer(c_int), intent(in), value :: scram_active     ! 1 if SCRAM active, 0 otherwise
        real(c_double), intent(out) :: new_reactivity         ! New smoothed reactivity
        
        real(c_double) :: fuel_temp_reactivity, graphite_temp_reactivity
        real(c_double) :: void_reactivity, xe_reactivity, rod_reactivity
        real(c_double) :: target_reactivity, smoothing_tau, smoothing_alpha
        
        ! 1. Fuel temperature feedback (Doppler effect - STRONG negative feedback)
        if (fuel_temp > REF_FUEL_TEMP) then
            fuel_temp_reactivity = ALPHA_FUEL * (fuel_temp - REF_FUEL_TEMP)
        else
            ! Limit positive feedback when cold
            fuel_temp_reactivity = min(ALPHA_FUEL * (fuel_temp - REF_FUEL_TEMP), 0.005d0)
        end if
        
        ! 2. Graphite temperature coefficient (POSITIVE in RBMK!)
        graphite_temp_reactivity = ALPHA_GRAPHITE * (graphite_temp - REF_GRAPHITE_TEMP)
        
        ! 3. Void coefficient (POSITIVE in RBMK - this is the dangerous part!)
        void_reactivity = ALPHA_VOID * coolant_void
        
        ! 4. Xenon poisoning (negative)
        xe_reactivity = -1.0d-18 * xenon_135
        
        ! 5. Control rod worth (negative when inserted)
        rod_reactivity = -rod_worth
        
        ! Calculate target reactivity
        target_reactivity = BASE_REACTIVITY + fuel_temp_reactivity + graphite_temp_reactivity &
                          + void_reactivity + xe_reactivity + rod_reactivity
        
        ! Apply exponential smoothing to reactivity changes for numerical stability
        if (scram_active == 1) then
            smoothing_tau = 0.05d0  ! Fast response during SCRAM
        else
            smoothing_tau = 0.3d0   ! Normal response
        end if
        smoothing_alpha = min(dt / smoothing_tau, 1.0d0)
        
        new_reactivity = smoothed_reactivity + smoothing_alpha * (target_reactivity - smoothed_reactivity)
        
        ! Clamp to physically reasonable bounds
        new_reactivity = max(min(new_reactivity, 0.02d0), -0.10d0)
        
    end subroutine calculate_total_reactivity

    ! =========================================================================
    ! Calculate control rod worth based on position
    ! Uses S-curve worth distribution (more realistic than linear)
    ! =========================================================================
    subroutine calculate_rod_worth(rod_position, max_worth, worth) bind(C, name="calculate_rod_worth")
        real(c_double), intent(in), value :: rod_position    ! 0.0 = fully inserted, 1.0 = fully withdrawn
        real(c_double), intent(in), value :: max_worth       ! Maximum rod worth [dk/k]
        real(c_double), intent(out) :: worth                 ! Current rod worth [dk/k]
        
        real(c_double) :: normalized_pos
        real(c_double), parameter :: PI_HALF = 1.5707963267948966d0
        
        ! Clamp position to valid range
        normalized_pos = max(min(rod_position, 1.0d0), 0.0d0)
        
        ! S-curve worth distribution
        ! Worth = max_worth * (1 - sin^2(pi/2 * position))
        worth = max_worth * (1.0d0 - sin(PI_HALF * normalized_pos)**2)
        
    end subroutine calculate_rod_worth

    ! =========================================================================
    ! Emergency SCRAM simulation
    ! Calculates reactivity insertion during emergency shutdown
    ! =========================================================================
    subroutine simulate_scram(time_since_scram, total_rod_worth, reactivity_inserted) &
               bind(C, name="simulate_scram")
        real(c_double), intent(in), value :: time_since_scram    ! Time since SCRAM [s]
        real(c_double), intent(in), value :: total_rod_worth     ! Total rod worth [dk/k]
        real(c_double), intent(out) :: reactivity_inserted       ! Reactivity inserted [dk/k]
        
        real(c_double) :: fraction_inserted
        
        if (time_since_scram <= 0.0d0) then
            reactivity_inserted = 0.0d0
        else if (time_since_scram >= ROD_DROP_TIME) then
            reactivity_inserted = -total_rod_worth
        else
            ! Exponential insertion profile
            fraction_inserted = 1.0d0 - exp(-3.0d0 * time_since_scram / ROD_DROP_TIME)
            reactivity_inserted = -total_rod_worth * fraction_inserted
        end if
        
    end subroutine simulate_scram

end module rbmk_reactivity
