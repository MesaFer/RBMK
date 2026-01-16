! =============================================================================
! RBMK Kinetics Module
! Point kinetics equations solver
! =============================================================================

module rbmk_kinetics
    use iso_c_binding
    use rbmk_constants
    implicit none
    
contains

    ! =========================================================================
    ! Point kinetics equation solver (simple Euler method)
    ! dn/dt = (rho - beta)/Lambda * n + lambda * C
    ! dC/dt = beta/Lambda * n - lambda * C
    ! =========================================================================
    subroutine solve_point_kinetics(n_neutrons, precursors, reactivity, dt, &
                                    n_new, precursors_new) bind(C, name="solve_point_kinetics")
        real(c_double), intent(in), value :: n_neutrons      ! Neutron population
        real(c_double), intent(in), value :: precursors      ! Delayed neutron precursors
        real(c_double), intent(in), value :: reactivity      ! Current reactivity
        real(c_double), intent(in), value :: dt              ! Time step [s]
        real(c_double), intent(out) :: n_new                 ! New neutron population
        real(c_double), intent(out) :: precursors_new        ! New precursors
        
        real(c_double) :: dn_dt, dC_dt
        
        ! Point kinetics equations
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
    ! Advanced point kinetics solver with RK4 and temperature feedback
    ! This is the main solver used in simulation steps
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
    ! Helper subroutine for RK4 derivatives
    ! =========================================================================
    subroutine kinetics_derivatives(n, c, fuel_temp, rho, dn_dt, dc_dt, dtemp_dt)
        real(c_double), intent(in) :: n, c, fuel_temp, rho
        real(c_double), intent(out) :: dn_dt, dc_dt, dtemp_dt
        
        real(c_double) :: temp_feedback, effective_rho, power_frac, target_temp
        
        ! Temperature feedback (Doppler effect)
        ! ALPHA_FUEL is negative, so:
        ! - Hot fuel (T > REF) gives negative feedback (good)
        ! - Cold fuel (T < REF) gives positive feedback (but limited)
        temp_feedback = ALPHA_FUEL * (fuel_temp - REF_FUEL_TEMP)
        
        ! Limit positive feedback from cold fuel to prevent runaway
        if (temp_feedback > 0.0d0) then
            temp_feedback = min(temp_feedback, 0.001d0)
        end if
        
        ! Calculate effective reactivity
        ! Do NOT add temperature feedback if reactivity is already strongly negative
        ! This prevents artificial power increase during shutdown
        if (rho < -0.005d0) then
            effective_rho = rho  ! Use raw reactivity during shutdown
        else
            effective_rho = rho + temp_feedback
        end if
        
        ! Clamp to physical bounds
        effective_rho = max(min(effective_rho, 0.02d0), -0.15d0)
        
        ! Point kinetics equations
        ! dn/dt = (rho - beta)/Lambda * n + lambda * C
        ! At negative reactivity, dn/dt should be negative (power decreasing)
        dn_dt = ((effective_rho - BETA_EFF) / NEUTRON_LIFETIME) * n + LAMBDA_DECAY * c
        dc_dt = (BETA_EFF / NEUTRON_LIFETIME) * n - LAMBDA_DECAY * c
        
        ! Temperature dynamics - fuel temperature follows power
        ! At low power (n << 1), temperature should decrease toward ambient
        power_frac = max(min(n, 10.0d0), 0.0d0)
        ! Target temperature: 400K at zero power, 900K at nominal (n=1)
        target_temp = 400.0d0 + 500.0d0 * power_frac
        ! Slower temperature response (thermal inertia)
        dtemp_dt = (target_temp - fuel_temp) / 10.0d0
        
    end subroutine kinetics_derivatives

end module rbmk_kinetics
