! =============================================================================
! RBMK Thermal Module
! Temperature and thermal-hydraulic calculations
! =============================================================================

module rbmk_thermal
    use iso_c_binding
    use rbmk_constants
    implicit none
    
contains

    ! =========================================================================
    ! Update temperatures based on power (thermal model)
    ! =========================================================================
    subroutine update_temperatures(power_percent, fuel_temp, coolant_temp, graphite_temp, &
                                   coolant_void, dt, &
                                   fuel_temp_new, coolant_temp_new, graphite_temp_new, &
                                   coolant_void_new) bind(C, name="update_temperatures")
        real(c_double), intent(in), value :: power_percent   ! Power as % of nominal
        real(c_double), intent(in), value :: fuel_temp       ! Current fuel temperature [K]
        real(c_double), intent(in), value :: coolant_temp    ! Current coolant temperature [K]
        real(c_double), intent(in), value :: graphite_temp   ! Current graphite temperature [K]
        real(c_double), intent(in), value :: coolant_void    ! Current void fraction [%]
        real(c_double), intent(in), value :: dt              ! Time step [s]
        real(c_double), intent(out) :: fuel_temp_new         ! New fuel temperature [K]
        real(c_double), intent(out) :: coolant_temp_new      ! New coolant temperature [K]
        real(c_double), intent(out) :: graphite_temp_new     ! New graphite temperature [K]
        real(c_double), intent(out) :: coolant_void_new      ! New void fraction [%]
        
        real(c_double) :: power_fraction, target_coolant_temp, target_graphite_temp
        real(c_double) :: coolant_alpha, graphite_alpha, void_alpha
        real(c_double) :: excess_temp, target_void
        
        power_fraction = max(min(power_percent / 100.0d0, 10.0d0), 0.0d0)
        target_coolant_temp = 400.0d0 + 150.0d0 * power_fraction
        target_graphite_temp = 400.0d0 + 250.0d0 * power_fraction
        
        ! Coolant temperature update (fast response)
        coolant_alpha = min(dt / COOLANT_TIME_CONST, 1.0d0)
        coolant_temp_new = coolant_temp + coolant_alpha * (target_coolant_temp - coolant_temp)
        
        ! Graphite temperature update (SLOW - large thermal mass)
        graphite_alpha = min(dt / GRAPHITE_TIME_CONST, 1.0d0)
        graphite_temp_new = graphite_temp + graphite_alpha * (target_graphite_temp - graphite_temp)
        
        ! Clamp temperatures
        coolant_temp_new = max(min(coolant_temp_new, 1000.0d0), 300.0d0)
        graphite_temp_new = max(min(graphite_temp_new, 1500.0d0), 300.0d0)
        
        ! Fuel temperature is passed through (calculated in kinetics)
        fuel_temp_new = max(min(fuel_temp, 3000.0d0), 300.0d0)
        
        ! Update void fraction (boiling model)
        void_alpha = min(dt / VOID_TIME_CONST, 1.0d0)
        
        if (coolant_temp_new > SATURATION_TEMP) then
            excess_temp = coolant_temp_new - SATURATION_TEMP
            ! More aggressive void formation - positive feedback mechanism
            target_void = min(excess_temp * 2.0d0, 80.0d0)  ! Max 80% void
            coolant_void_new = coolant_void + void_alpha * (target_void - coolant_void)
        else
            ! Void collapses when below saturation
            coolant_void_new = coolant_void * (1.0d0 - void_alpha)
        end if
        coolant_void_new = max(min(coolant_void_new, 80.0d0), 0.0d0)
        
    end subroutine update_temperatures

    ! =========================================================================
    ! Calculate thermal power from neutron population
    ! =========================================================================
    subroutine calculate_thermal_power(n_neutrons, n_nominal, power_mw) bind(C, name="calculate_thermal_power")
        real(c_double), intent(in), value :: n_neutrons      ! Current neutron population
        real(c_double), intent(in), value :: n_nominal       ! Nominal neutron population
        real(c_double), intent(out) :: power_mw              ! Thermal power [MW]
        
        if (n_nominal > 0.0d0) then
            power_mw = NOMINAL_POWER * (n_neutrons / n_nominal)
        else
            power_mw = 0.0d0
        end if
        
        ! Ensure non-negative
        power_mw = max(power_mw, 0.0d0)
        
    end subroutine calculate_thermal_power

end module rbmk_thermal
