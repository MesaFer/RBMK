! =============================================================================
! RBMK Kinetics Module
! 6-Group Point Kinetics Equations Solver
! =============================================================================
!
! Implements the standard 6-group delayed neutron kinetics equations:
!
!   dn/dt = (ρ - β)/Λ · n + Σᵢ λᵢCᵢ + S
!   dCᵢ/dt = βᵢ/Λ · n - λᵢCᵢ   (for i = 1...6)
!
! Where:
!   n   - neutron population (normalized to nominal power)
!   Cᵢ  - concentration of delayed neutron precursors for group i
!   ρ   - reactivity
!   β   - total delayed neutron fraction (Σβᵢ ≈ 0.0065 for U-235)
!   βᵢ  - delayed neutron fraction for group i
!   Λ   - prompt neutron generation time (~10⁻⁴ s for RBMK)
!   λᵢ  - decay constant for group i
!   S   - external neutron source
!
! =============================================================================

module rbmk_kinetics
    use iso_c_binding
    use rbmk_constants
    implicit none
    
contains

    ! =========================================================================
    ! 6-Group Point Kinetics Solver (Simple Euler method)
    ! For basic integration - use RK4 version for production
    ! =========================================================================
    subroutine solve_point_kinetics(n_neutrons, precursors, reactivity, dt, &
                                    n_new, precursors_new) bind(C, name="solve_point_kinetics")
        real(c_double), intent(in), value :: n_neutrons      ! Neutron population
        real(c_double), intent(in), value :: precursors      ! Total delayed neutron precursors (legacy)
        real(c_double), intent(in), value :: reactivity      ! Current reactivity
        real(c_double), intent(in), value :: dt              ! Time step [s]
        real(c_double), intent(out) :: n_new                 ! New neutron population
        real(c_double), intent(out) :: precursors_new        ! New total precursors
        
        real(c_double) :: dn_dt, dC_dt
        real(c_double) :: delayed_source
        
        ! Calculate delayed neutron source (using effective single-group approximation)
        delayed_source = LAMBDA_DECAY * precursors
        
        ! Point kinetics equations
        ! dn/dt = (ρ - β)/Λ · n + λ·C
        dn_dt = ((reactivity - BETA_EFF) / NEUTRON_LIFETIME) * n_neutrons + delayed_source
        
        ! dC/dt = β/Λ · n - λ·C
        dC_dt = (BETA_EFF / NEUTRON_LIFETIME) * n_neutrons - LAMBDA_DECAY * precursors
        
        ! Update values
        n_new = n_neutrons + dn_dt * dt
        precursors_new = precursors + dC_dt * dt
        
        ! Ensure non-negative values
        if (n_new < 0.0d0) n_new = 0.0d0
        if (precursors_new < 0.0d0) precursors_new = 0.0d0
        
    end subroutine solve_point_kinetics

    ! =========================================================================
    ! 6-Group Point Kinetics Solver with RK4 and Temperature Feedback
    ! This is the main solver used in simulation steps
    ! 
    ! Uses 6 separate precursor groups for accurate delayed neutron dynamics
    ! =========================================================================
    subroutine solve_point_kinetics_6group(n_neutrons, precursors_6, fuel_temp, reactivity, &
                                           source_term, dt, n_new, precursors_6_new, &
                                           fuel_temp_new) bind(C, name="solve_point_kinetics_6group")
        real(c_double), intent(in), value :: n_neutrons              ! Neutron population
        real(c_double), intent(in) :: precursors_6(NUM_DELAYED_GROUPS) ! 6-group precursors
        real(c_double), intent(in), value :: fuel_temp               ! Fuel temperature [K]
        real(c_double), intent(in), value :: reactivity              ! Current reactivity
        real(c_double), intent(in), value :: source_term             ! External source S
        real(c_double), intent(in), value :: dt                      ! Time step [s]
        real(c_double), intent(out) :: n_new                         ! New neutron population
        real(c_double), intent(out) :: precursors_6_new(NUM_DELAYED_GROUPS) ! New 6-group precursors
        real(c_double), intent(out) :: fuel_temp_new                 ! New fuel temperature [K]
        
        real(c_double) :: effective_dt, substep_dt
        real(c_double) :: n_current, t_current
        real(c_double) :: c_current(NUM_DELAYED_GROUPS)
        real(c_double) :: k1_n, k2_n, k3_n, k4_n
        real(c_double) :: k1_c(NUM_DELAYED_GROUPS), k2_c(NUM_DELAYED_GROUPS)
        real(c_double) :: k3_c(NUM_DELAYED_GROUPS), k4_c(NUM_DELAYED_GROUPS)
        real(c_double) :: k1_t, k2_t, k3_t, k4_t
        real(c_double) :: c_temp(NUM_DELAYED_GROUPS)
        integer :: num_substeps, i, g
        
        ! For strongly negative reactivity (SCRAM), use smaller time steps
        if (reactivity < -0.01d0) then
            effective_dt = min(dt, 0.005d0)
        else if (abs(reactivity) > BETA_EFF) then
            ! Near prompt critical - need very small steps
            effective_dt = min(dt, 0.001d0)
        else
            effective_dt = dt
        end if
        num_substeps = ceiling(dt / effective_dt)
        substep_dt = dt / dble(num_substeps)
        
        ! Initialize
        n_current = n_neutrons
        c_current = precursors_6
        t_current = fuel_temp
        
        ! Run sub-steps with RK4
        do i = 1, num_substeps
            ! RK4 stage 1
            call kinetics_derivatives_6group(n_current, c_current, t_current, &
                                            reactivity, source_term, k1_n, k1_c, k1_t)
            
            ! RK4 stage 2
            c_temp = c_current + 0.5d0*substep_dt*k1_c
            call kinetics_derivatives_6group(n_current + 0.5d0*substep_dt*k1_n, &
                                            c_temp, &
                                            t_current + 0.5d0*substep_dt*k1_t, &
                                            reactivity, source_term, k2_n, k2_c, k2_t)
            
            ! RK4 stage 3
            c_temp = c_current + 0.5d0*substep_dt*k2_c
            call kinetics_derivatives_6group(n_current + 0.5d0*substep_dt*k2_n, &
                                            c_temp, &
                                            t_current + 0.5d0*substep_dt*k2_t, &
                                            reactivity, source_term, k3_n, k3_c, k3_t)
            
            ! RK4 stage 4
            c_temp = c_current + substep_dt*k3_c
            call kinetics_derivatives_6group(n_current + substep_dt*k3_n, &
                                            c_temp, &
                                            t_current + substep_dt*k3_t, &
                                            reactivity, source_term, k4_n, k4_c, k4_t)
            
            ! RK4 update
            n_current = n_current + (substep_dt/6.0d0) * (k1_n + 2.0d0*k2_n + 2.0d0*k3_n + k4_n)
            do g = 1, NUM_DELAYED_GROUPS
                c_current(g) = c_current(g) + (substep_dt/6.0d0) * &
                              (k1_c(g) + 2.0d0*k2_c(g) + 2.0d0*k3_c(g) + k4_c(g))
            end do
            t_current = t_current + (substep_dt/6.0d0) * (k1_t + 2.0d0*k2_t + 2.0d0*k3_t + k4_t)
            
            ! Clamp values
            n_current = max(min(n_current, 10.0d0), 1.0d-10)
            do g = 1, NUM_DELAYED_GROUPS
                c_current(g) = max(c_current(g), 0.0d0)
            end do
        end do
        
        n_new = n_current
        precursors_6_new = c_current
        fuel_temp_new = t_current
        
    end subroutine solve_point_kinetics_6group
    
    ! =========================================================================
    ! Helper subroutine for 6-group RK4 derivatives
    ! Implements the full 6-group point kinetics equations
    ! =========================================================================
    subroutine kinetics_derivatives_6group(n, c, fuel_temp, rho, source, &
                                           dn_dt, dc_dt, dtemp_dt)
        real(c_double), intent(in) :: n
        real(c_double), intent(in) :: c(NUM_DELAYED_GROUPS)
        real(c_double), intent(in) :: fuel_temp, rho, source
        real(c_double), intent(out) :: dn_dt
        real(c_double), intent(out) :: dc_dt(NUM_DELAYED_GROUPS)
        real(c_double), intent(out) :: dtemp_dt
        
        real(c_double) :: temp_feedback, effective_rho, power_frac, target_temp
        real(c_double) :: prompt_term, delayed_source
        integer :: g
        
        ! Temperature feedback (Doppler effect)
        ! ALPHA_FUEL is negative (-5e-5), so higher temperature = more negative reactivity
        temp_feedback = ALPHA_FUEL * (fuel_temp - REF_FUEL_TEMP)
        
        ! Doppler effect only provides NEGATIVE feedback (stabilizing)
        if (temp_feedback > 0.0d0) then
            temp_feedback = 0.0d0
        end if
        
        ! Calculate effective reactivity
        effective_rho = rho + temp_feedback
        
        ! Clamp to physical bounds
        effective_rho = max(min(effective_rho, 0.02d0), -0.15d0)
        
        ! Calculate delayed neutron source from all 6 groups
        ! Σᵢ λᵢCᵢ
        delayed_source = 0.0d0
        do g = 1, NUM_DELAYED_GROUPS
            delayed_source = delayed_source + LAMBDA_I(g) * c(g)
        end do
        
        ! Neutron population equation:
        ! dn/dt = (ρ - β)/Λ · n + Σᵢ λᵢCᵢ + S
        prompt_term = ((effective_rho - BETA_EFF) / NEUTRON_LIFETIME) * n
        dn_dt = prompt_term + delayed_source + source
        
        ! Precursor equations for each group:
        ! dCᵢ/dt = βᵢ/Λ · n - λᵢCᵢ
        do g = 1, NUM_DELAYED_GROUPS
            dc_dt(g) = (BETA_I(g) / NEUTRON_LIFETIME) * n - LAMBDA_I(g) * c(g)
        end do
        
        ! For very low neutron population with positive reactivity,
        ! ensure minimum growth rate to bootstrap the reactor
        if (effective_rho > 0.0d0 .and. n < 1.0d-4) then
            if (effective_rho >= BETA_EFF) then
                ! Prompt supercritical - very fast growth
                dn_dt = max(dn_dt, ((effective_rho - BETA_EFF) / NEUTRON_LIFETIME) * n)
            else
                ! Delayed supercritical - growth via delayed neutrons
                ! Use weighted average lambda for period estimate
                dn_dt = max(dn_dt, n * LAMBDA_DECAY * effective_rho / BETA_EFF)
            end if
        end if
        
        ! Temperature dynamics - fuel temperature follows power
        power_frac = max(min(n, 10.0d0), 0.0d0)
        target_temp = 400.0d0 + 500.0d0 * power_frac
        dtemp_dt = (target_temp - fuel_temp) / 10.0d0
        
    end subroutine kinetics_derivatives_6group

    ! =========================================================================
    ! Legacy RK4 solver with single-group precursors (for backward compatibility)
    ! =========================================================================
    subroutine solve_point_kinetics_rk4(n_neutrons, precursors, fuel_temp, reactivity, dt, &
                                        n_new, precursors_new, fuel_temp_new) &
                                        bind(C, name="solve_point_kinetics_rk4")
        real(c_double), intent(in), value :: n_neutrons      ! Neutron population
        real(c_double), intent(in), value :: precursors      ! Delayed neutron precursors
        real(c_double), intent(in), value :: fuel_temp       ! Fuel temperature [K]
        real(c_double), intent(in), value :: reactivity      ! Current reactivity
        real(c_double), intent(in), value :: dt              ! Time step [s]
        real(c_double), intent(out) :: n_new                 ! New neutron population
        real(c_double), intent(out) :: precursors_new        ! New precursors
        real(c_double), intent(out) :: fuel_temp_new         ! New fuel temperature [K]
        
        real(c_double) :: effective_dt, substep_dt
        real(c_double) :: n_current, c_current, t_current
        real(c_double) :: k1_n, k1_c, k1_t, k2_n, k2_c, k2_t
        real(c_double) :: k3_n, k3_c, k3_t, k4_n, k4_c, k4_t
        integer :: num_substeps, i
        
        ! For strongly negative reactivity (SCRAM), use smaller time steps
        if (reactivity < -0.01d0) then
            effective_dt = min(dt, 0.01d0)
        else
            effective_dt = dt
        end if
        num_substeps = ceiling(dt / effective_dt)
        substep_dt = dt / dble(num_substeps)
        
        ! Initialize
        n_current = n_neutrons
        c_current = precursors
        t_current = fuel_temp
        
        ! Run sub-steps
        do i = 1, num_substeps
            ! RK4 stage 1
            call kinetics_derivatives(n_current, c_current, t_current, reactivity, &
                                     k1_n, k1_c, k1_t)
            
            ! RK4 stage 2
            call kinetics_derivatives(n_current + 0.5d0*substep_dt*k1_n, &
                                     c_current + 0.5d0*substep_dt*k1_c, &
                                     t_current + 0.5d0*substep_dt*k1_t, &
                                     reactivity, k2_n, k2_c, k2_t)
            
            ! RK4 stage 3
            call kinetics_derivatives(n_current + 0.5d0*substep_dt*k2_n, &
                                     c_current + 0.5d0*substep_dt*k2_c, &
                                     t_current + 0.5d0*substep_dt*k2_t, &
                                     reactivity, k3_n, k3_c, k3_t)
            
            ! RK4 stage 4
            call kinetics_derivatives(n_current + substep_dt*k3_n, &
                                     c_current + substep_dt*k3_c, &
                                     t_current + substep_dt*k3_t, &
                                     reactivity, k4_n, k4_c, k4_t)
            
            ! RK4 update
            n_current = n_current + (substep_dt/6.0d0) * (k1_n + 2.0d0*k2_n + 2.0d0*k3_n + k4_n)
            c_current = c_current + (substep_dt/6.0d0) * (k1_c + 2.0d0*k2_c + 2.0d0*k3_c + k4_c)
            t_current = t_current + (substep_dt/6.0d0) * (k1_t + 2.0d0*k2_t + 2.0d0*k3_t + k4_t)
            
            ! Clamp values
            n_current = max(min(n_current, 10.0d0), 1.0d-10)
            c_current = max(c_current, 0.0d0)
        end do
        
        n_new = n_current
        precursors_new = c_current
        fuel_temp_new = t_current
        
    end subroutine solve_point_kinetics_rk4
    
    ! =========================================================================
    ! Helper subroutine for legacy single-group RK4 derivatives
    ! =========================================================================
    subroutine kinetics_derivatives(n, c, fuel_temp, rho, dn_dt, dc_dt, dtemp_dt)
        real(c_double), intent(in) :: n, c, fuel_temp, rho
        real(c_double), intent(out) :: dn_dt, dc_dt, dtemp_dt
        
        real(c_double) :: temp_feedback, effective_rho, power_frac, target_temp
        real(c_double) :: prompt_term, delayed_term
        
        ! Temperature feedback (Doppler effect)
        temp_feedback = ALPHA_FUEL * (fuel_temp - REF_FUEL_TEMP)
        
        ! Doppler effect only provides NEGATIVE feedback (stabilizing)
        if (temp_feedback > 0.0d0) then
            temp_feedback = 0.0d0
        end if
        
        ! Calculate effective reactivity
        effective_rho = rho + temp_feedback
        
        ! Clamp to physical bounds
        effective_rho = max(min(effective_rho, 0.02d0), -0.15d0)
        
        ! Point kinetics equations
        prompt_term = ((effective_rho - BETA_EFF) / NEUTRON_LIFETIME) * n
        delayed_term = LAMBDA_DECAY * c
        
        dn_dt = prompt_term + delayed_term
        dc_dt = (BETA_EFF / NEUTRON_LIFETIME) * n - LAMBDA_DECAY * c
        
        ! For very low neutron population with positive reactivity
        if (effective_rho > 0.0d0 .and. n < 1.0d-4) then
            if (effective_rho >= BETA_EFF) then
                dn_dt = max(dn_dt, ((effective_rho - BETA_EFF) / NEUTRON_LIFETIME) * n)
            else
                dn_dt = max(dn_dt, n * LAMBDA_DECAY * effective_rho / BETA_EFF)
            end if
        end if
        
        ! Temperature dynamics
        power_frac = max(min(n, 10.0d0), 0.0d0)
        target_temp = 400.0d0 + 500.0d0 * power_frac
        dtemp_dt = (target_temp - fuel_temp) / 10.0d0
        
    end subroutine kinetics_derivatives

    ! =========================================================================
    ! Initialize 6-group precursor concentrations for steady state
    ! At steady state: dCᵢ/dt = 0 => Cᵢ = βᵢ·n / (λᵢ·Λ)
    ! =========================================================================
    subroutine init_precursors_6group(n_neutrons, precursors_6) &
                                      bind(C, name="init_precursors_6group")
        real(c_double), intent(in), value :: n_neutrons
        real(c_double), intent(out) :: precursors_6(NUM_DELAYED_GROUPS)
        
        integer :: g
        
        ! At steady state: Cᵢ = βᵢ·n / (λᵢ·Λ)
        do g = 1, NUM_DELAYED_GROUPS
            precursors_6(g) = (BETA_I(g) * n_neutrons) / (LAMBDA_I(g) * NEUTRON_LIFETIME)
        end do
        
    end subroutine init_precursors_6group
    
    ! =========================================================================
    ! Calculate total precursor concentration from 6-group values
    ! =========================================================================
    subroutine sum_precursors_6group(precursors_6, total) &
                                     bind(C, name="sum_precursors_6group")
        real(c_double), intent(in) :: precursors_6(NUM_DELAYED_GROUPS)
        real(c_double), intent(out) :: total
        
        integer :: g
        
        total = 0.0d0
        do g = 1, NUM_DELAYED_GROUPS
            total = total + precursors_6(g)
        end do
        
    end subroutine sum_precursors_6group
    
    ! =========================================================================
    ! Calculate reactor period from current state
    ! For delayed supercritical: T ≈ (β - ρ) / (λ_eff · ρ)
    ! For prompt supercritical: T ≈ Λ / (ρ - β)
    ! =========================================================================
    subroutine calculate_reactor_period(reactivity, period) &
                                        bind(C, name="calculate_reactor_period")
        real(c_double), intent(in), value :: reactivity
        real(c_double), intent(out) :: period
        
        if (abs(reactivity) < 1.0d-8) then
            ! Critical - infinite period
            period = 1.0d10
        else if (reactivity > 0.0d0) then
            if (reactivity >= BETA_EFF) then
                ! Prompt supercritical
                period = NEUTRON_LIFETIME / (reactivity - BETA_EFF)
            else
                ! Delayed supercritical
                period = (BETA_EFF - reactivity) / (LAMBDA_DECAY * reactivity)
            end if
        else
            ! Subcritical - negative period (decay)
            period = (BETA_EFF - reactivity) / (LAMBDA_DECAY * abs(reactivity))
            period = -period
        end if
        
    end subroutine calculate_reactor_period
    
    ! =========================================================================
    ! Convert reactivity to dollars
    ! 1 dollar = β_eff ≈ 0.0065
    ! =========================================================================
    subroutine reactivity_to_dollars(reactivity, dollars) &
                                     bind(C, name="reactivity_to_dollars")
        real(c_double), intent(in), value :: reactivity
        real(c_double), intent(out) :: dollars
        
        dollars = reactivity / BETA_EFF
        
    end subroutine reactivity_to_dollars

end module rbmk_kinetics
