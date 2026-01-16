! =============================================================================
! RBMK Reactor Physics Module
! Fortran module for nuclear physics calculations
! =============================================================================
! This module implements core nuclear physics calculations for RBMK-1000 reactor:
! - Neutron diffusion equation solver (one-group approximation)
! - Reactivity calculations
! - Xenon poisoning dynamics
! - Fuel temperature feedback
! =============================================================================

module rbmk_physics
    implicit none
    
    ! Physical constants
    real(8), parameter :: NEUTRON_LIFETIME = 1.0d-3      ! Prompt neutron lifetime [s]
    real(8), parameter :: BETA_EFF = 0.0065d0            ! Effective delayed neutron fraction
    real(8), parameter :: LAMBDA_DECAY = 0.0767d0        ! Decay constant for delayed neutrons [1/s]
    real(8), parameter :: SIGMA_XE = 2.65d-18            ! Xenon-135 absorption cross-section [cm^2]
    real(8), parameter :: LAMBDA_XE = 2.09d-5            ! Xenon-135 decay constant [1/s]
    real(8), parameter :: LAMBDA_I = 2.87d-5             ! Iodine-135 decay constant [1/s]
    real(8), parameter :: GAMMA_I = 0.061d0              ! Iodine-135 fission yield
    real(8), parameter :: GAMMA_XE = 0.003d0             ! Direct Xenon-135 fission yield
    
    ! RBMK-1000 specific parameters
    real(8), parameter :: CORE_HEIGHT = 700.0d0          ! Active core height [cm]
    real(8), parameter :: CORE_RADIUS = 593.0d0          ! Core radius [cm]
    real(8), parameter :: NUM_CHANNELS = 1661            ! Number of fuel channels
    real(8), parameter :: NOMINAL_POWER = 3200.0d0       ! Nominal thermal power [MW]
    
    ! Diffusion parameters (typical values for graphite-moderated reactor)
    real(8), parameter :: D_COEFF = 0.84d0               ! Diffusion coefficient [cm]
    real(8), parameter :: SIGMA_A = 0.0034d0             ! Macroscopic absorption cross-section [1/cm]
    real(8), parameter :: NU_SIGMA_F = 0.0041d0          ! Nu * fission cross-section [1/cm]
    
    ! Temperature feedback coefficients (RBMK has positive void coefficient!)
    real(8), parameter :: ALPHA_FUEL = -1.2d-5           ! Fuel temperature coefficient [1/K]
    real(8), parameter :: ALPHA_VOID = 2.0d-4            ! Void coefficient (POSITIVE!) [1/%void]
    real(8), parameter :: ALPHA_GRAPHITE = -0.5d-5       ! Graphite temperature coefficient [1/K]
    
contains

    ! =========================================================================
    ! Calculate neutron flux using one-group diffusion equation
    ! Solves: D*nabla^2(phi) - Sigma_a*phi + nu*Sigma_f*phi = 0
    ! Using finite difference method for 1D axial distribution
    ! =========================================================================
    subroutine calculate_neutron_flux(n_points, dz, flux, k_eff) bind(C, name="calculate_neutron_flux")
        use iso_c_binding
        integer(c_int), intent(in), value :: n_points
        real(c_double), intent(in), value :: dz
        real(c_double), intent(inout) :: flux(n_points)
        real(c_double), intent(out) :: k_eff
        
        real(8) :: flux_new(n_points)
        real(8) :: source, leakage
        real(8) :: total_fission, total_absorption
        integer :: i, iter
        integer, parameter :: MAX_ITER = 1000
        real(8), parameter :: TOLERANCE = 1.0d-6
        real(8) :: k_old, diff
        
        ! Initialize with cosine distribution (fundamental mode)
        do i = 1, n_points
            flux(i) = cos(3.14159265d0 * (dble(i) - dble(n_points)/2.0d0) / dble(n_points))
            if (flux(i) < 0.0d0) flux(i) = 0.0d0
        end do
        
        ! Normalize initial flux
        flux = flux / sum(flux)
        k_eff = 1.0d0
        
        ! Power iteration method
        do iter = 1, MAX_ITER
            k_old = k_eff
            total_fission = 0.0d0
            total_absorption = 0.0d0
            
            ! Calculate new flux distribution
            do i = 2, n_points - 1
                ! Diffusion term (second derivative)
                leakage = D_COEFF * (flux(i+1) - 2.0d0*flux(i) + flux(i-1)) / (dz * dz)
                
                ! Source term (fission)
                source = NU_SIGMA_F * flux(i) / k_eff
                
                ! New flux from balance equation
                flux_new(i) = (source + leakage / SIGMA_A)
                if (flux_new(i) < 0.0d0) flux_new(i) = 0.0d0
                
                total_fission = total_fission + NU_SIGMA_F * flux(i)
                total_absorption = total_absorption + SIGMA_A * flux(i)
            end do
            
            ! Boundary conditions (zero flux at extrapolated boundary)
            flux_new(1) = 0.0d0
            flux_new(n_points) = 0.0d0
            
            ! Update k_eff
            if (total_absorption > 0.0d0) then
                k_eff = total_fission / total_absorption
            end if
            
            ! Normalize and update flux
            if (sum(flux_new) > 0.0d0) then
                flux = flux_new / sum(flux_new)
            end if
            
            ! Check convergence
            diff = abs(k_eff - k_old)
            if (diff < TOLERANCE) exit
        end do
        
    end subroutine calculate_neutron_flux

    ! =========================================================================
    ! Calculate reactivity with temperature and xenon feedback
    ! rho = (k_eff - 1) / k_eff
    ! =========================================================================
    subroutine calculate_reactivity(k_eff, fuel_temp, coolant_void, xe_concentration, &
                                    graphite_temp, reactivity) bind(C, name="calculate_reactivity")
        use iso_c_binding
        real(c_double), intent(in), value :: k_eff
        real(c_double), intent(in), value :: fuel_temp        ! [K]
        real(c_double), intent(in), value :: coolant_void     ! [%]
        real(c_double), intent(in), value :: xe_concentration ! [atoms/cm^3]
        real(c_double), intent(in), value :: graphite_temp    ! [K]
        real(c_double), intent(out) :: reactivity
        
        real(8) :: rho_base, delta_rho_fuel, delta_rho_void
        real(8) :: delta_rho_xe, delta_rho_graphite
        real(8) :: ref_fuel_temp, ref_graphite_temp
        
        ! Reference temperatures
        ref_fuel_temp = 800.0d0      ! Reference fuel temperature [K]
        ref_graphite_temp = 600.0d0  ! Reference graphite temperature [K]
        
        ! Base reactivity from k_eff
        if (k_eff > 0.0d0) then
            rho_base = (k_eff - 1.0d0) / k_eff
        else
            rho_base = 0.0d0
        end if
        
        ! Fuel temperature feedback (Doppler effect - negative)
        delta_rho_fuel = ALPHA_FUEL * (fuel_temp - ref_fuel_temp)
        
        ! Void coefficient feedback (POSITIVE in RBMK - this is the dangerous part!)
        delta_rho_void = ALPHA_VOID * coolant_void
        
        ! Xenon poisoning (negative reactivity)
        delta_rho_xe = -SIGMA_XE * xe_concentration * 1.0d-24  ! Convert to macroscopic
        
        ! Graphite temperature feedback
        delta_rho_graphite = ALPHA_GRAPHITE * (graphite_temp - ref_graphite_temp)
        
        ! Total reactivity
        reactivity = rho_base + delta_rho_fuel + delta_rho_void + delta_rho_xe + delta_rho_graphite
        
    end subroutine calculate_reactivity

    ! =========================================================================
    ! Point kinetics equation solver
    ! dn/dt = (rho - beta)/Lambda * n + lambda * C
    ! dC/dt = beta/Lambda * n - lambda * C
    ! =========================================================================
    subroutine solve_point_kinetics(n_neutrons, precursors, reactivity, dt, &
                                    n_new, precursors_new) bind(C, name="solve_point_kinetics")
        use iso_c_binding
        real(c_double), intent(in), value :: n_neutrons      ! Neutron population
        real(c_double), intent(in), value :: precursors      ! Delayed neutron precursors
        real(c_double), intent(in), value :: reactivity      ! Current reactivity
        real(c_double), intent(in), value :: dt              ! Time step [s]
        real(c_double), intent(out) :: n_new                 ! New neutron population
        real(c_double), intent(out) :: precursors_new        ! New precursors
        
        real(8) :: dn_dt, dC_dt
        real(8) :: rho_dollars
        
        ! Convert reactivity to dollars
        rho_dollars = reactivity / BETA_EFF
        
        ! Point kinetics equations (simple Euler method)
        dn_dt = ((reactivity - BETA_EFF) / NEUTRON_LIFETIME) * n_neutrons + &
                LAMBDA_DECAY * precursors
        
        dC_dt = (BETA_EFF / NEUTRON_LIFETIME) * n_neutrons - LAMBDA_DECAY * precursors
        
        ! Update values
        n_new = n_neutrons + dn_dt * dt
        precursors_new = precursors + dC_dt * dt
        
        ! Ensure non-negative values
        if (n_new < 0.0d0) n_new = 0.0d0
        if (precursors_new < 0.0d0) precursors_new = 0.0d0
        
    end subroutine solve_point_kinetics

    ! =========================================================================
    ! Xenon dynamics calculation
    ! dI/dt = gamma_I * Sigma_f * phi - lambda_I * I
    ! dXe/dt = gamma_Xe * Sigma_f * phi + lambda_I * I - lambda_Xe * Xe - sigma_Xe * phi * Xe
    ! =========================================================================
    subroutine calculate_xenon_dynamics(iodine, xenon, neutron_flux, dt, &
                                        iodine_new, xenon_new) bind(C, name="calculate_xenon_dynamics")
        use iso_c_binding
        real(c_double), intent(in), value :: iodine          ! I-135 concentration [atoms/cm^3]
        real(c_double), intent(in), value :: xenon           ! Xe-135 concentration [atoms/cm^3]
        real(c_double), intent(in), value :: neutron_flux    ! Neutron flux [n/cm^2/s]
        real(c_double), intent(in), value :: dt              ! Time step [s]
        real(c_double), intent(out) :: iodine_new            ! New I-135 concentration
        real(c_double), intent(out) :: xenon_new             ! New Xe-135 concentration
        
        real(8) :: fission_rate, dI_dt, dXe_dt
        real(8), parameter :: SIGMA_F = 0.0025d0  ! Fission cross-section [1/cm]
        
        ! Fission rate
        fission_rate = SIGMA_F * neutron_flux
        
        ! Iodine-135 production and decay
        dI_dt = GAMMA_I * fission_rate - LAMBDA_I * iodine
        
        ! Xenon-135 production (direct + from I-135 decay) and removal (decay + burnup)
        dXe_dt = GAMMA_XE * fission_rate + LAMBDA_I * iodine - &
                 LAMBDA_XE * xenon - SIGMA_XE * neutron_flux * xenon * 1.0d-24
        
        ! Update concentrations (simple Euler)
        iodine_new = iodine + dI_dt * dt
        xenon_new = xenon + dXe_dt * dt
        
        ! Ensure non-negative
        if (iodine_new < 0.0d0) iodine_new = 0.0d0
        if (xenon_new < 0.0d0) xenon_new = 0.0d0
        
    end subroutine calculate_xenon_dynamics

    ! =========================================================================
    ! Calculate thermal power from neutron population
    ! =========================================================================
    subroutine calculate_thermal_power(n_neutrons, n_nominal, power_mw) bind(C, name="calculate_thermal_power")
        use iso_c_binding
        real(c_double), intent(in), value :: n_neutrons      ! Current neutron population
        real(c_double), intent(in), value :: n_nominal       ! Nominal neutron population
        real(c_double), intent(out) :: power_mw              ! Thermal power [MW]
        
        if (n_nominal > 0.0d0) then
            power_mw = NOMINAL_POWER * (n_neutrons / n_nominal)
        else
            power_mw = 0.0d0
        end if
        
    end subroutine calculate_thermal_power

    ! =========================================================================
    ! Calculate control rod worth
    ! Simplified model: linear worth distribution
    ! =========================================================================
    subroutine calculate_rod_worth(rod_position, max_worth, worth) bind(C, name="calculate_rod_worth")
        use iso_c_binding
        real(c_double), intent(in), value :: rod_position    ! 0.0 = fully inserted, 1.0 = fully withdrawn
        real(c_double), intent(in), value :: max_worth       ! Maximum rod worth [dk/k]
        real(c_double), intent(out) :: worth                 ! Current rod worth [dk/k]
        
        real(8) :: normalized_pos
        
        ! Clamp position to valid range
        normalized_pos = rod_position
        if (normalized_pos < 0.0d0) normalized_pos = 0.0d0
        if (normalized_pos > 1.0d0) normalized_pos = 1.0d0
        
        ! S-curve worth distribution (more realistic than linear)
        ! Worth = max_worth * (1 - sin^2(pi/2 * position))
        worth = max_worth * (1.0d0 - sin(1.5707963d0 * normalized_pos)**2)
        
    end subroutine calculate_rod_worth

    ! =========================================================================
    ! Emergency SCRAM simulation
    ! Calculates reactivity insertion during emergency shutdown
    ! =========================================================================
    subroutine simulate_scram(time_since_scram, total_rod_worth, reactivity_inserted) &
               bind(C, name="simulate_scram")
        use iso_c_binding
        real(c_double), intent(in), value :: time_since_scram    ! Time since SCRAM [s]
        real(c_double), intent(in), value :: total_rod_worth     ! Total rod worth [dk/k]
        real(c_double), intent(out) :: reactivity_inserted       ! Reactivity inserted [dk/k]
        
        real(8), parameter :: ROD_DROP_TIME = 2.5d0  ! Time for full rod insertion [s]
        real(8) :: fraction_inserted
        
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

end module rbmk_physics
