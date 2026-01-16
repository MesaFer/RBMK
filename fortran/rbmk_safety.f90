! =============================================================================
! RBMK Safety Module
! Explosion detection and safety calculations
! =============================================================================

module rbmk_safety
    use iso_c_binding
    use rbmk_constants
    implicit none
    
contains

    ! =========================================================================
    ! Detect steam explosion based on physics conditions
    ! Returns explosion severity (0 = safe, >= 1.0 = explosion)
    ! =========================================================================
    subroutine detect_explosion(fuel_temp, coolant_temp, coolant_void, &
                                reactivity_dollars, power_percent, &
                                explosion_severity) bind(C, name="detect_explosion")
        real(c_double), intent(in), value :: fuel_temp        ! [K]
        real(c_double), intent(in), value :: coolant_temp     ! [K]
        real(c_double), intent(in), value :: coolant_void     ! [%]
        real(c_double), intent(in), value :: reactivity_dollars ! Reactivity in $
        real(c_double), intent(in), value :: power_percent    ! Power as % of nominal
        real(c_double), intent(out) :: explosion_severity     ! 0 = safe, >= 1.0 = explosion
        
        real(c_double) :: void_excess, temp_excess, supercritical_excess, power_excess
        
        explosion_severity = 0.0d0
        
        ! Condition 1: Fuel approaching or exceeding melting point
        if (fuel_temp > FUEL_MELTING_POINT) then
            explosion_severity = explosion_severity + 1.0d0
        else if (fuel_temp > FUEL_MELTING_POINT * 0.9d0) then
            explosion_severity = explosion_severity + 0.5d0
        end if
        
        ! Condition 2: Rapid steam generation (high void + high temp)
        if (coolant_void > CRITICAL_VOID_FRACTION .and. &
            coolant_temp > CRITICAL_COOLANT_TEMP) then
            void_excess = min((coolant_void - CRITICAL_VOID_FRACTION) / 25.0d0, 1.0d0)
            temp_excess = min((coolant_temp - CRITICAL_COOLANT_TEMP) / 300.0d0, 1.0d0)
            explosion_severity = explosion_severity + void_excess * temp_excess
        end if
        
        ! Condition 3: Prompt supercritical condition
        ! Only counts toward explosion if there's actual power to cause damage
        ! Prompt critical at zero power just means fast startup, not explosion
        if (reactivity_dollars > PROMPT_SUPERCRITICAL .and. power_percent > 10.0d0) then
            supercritical_excess = min((reactivity_dollars - PROMPT_SUPERCRITICAL) / 2.0d0, 1.0d0)
            ! Scale by power level - no power = no explosion
            supercritical_excess = supercritical_excess * min(power_percent / 100.0d0, 1.0d0)
            explosion_severity = explosion_severity + supercritical_excess
        end if
        
        ! Condition 4: Extreme power excursion (only if reactivity positive and power is high)
        if (power_percent > EXTREME_POWER_FACTOR * 100.0d0 .and. reactivity_dollars > 0.0d0) then
            power_excess = min((power_percent - EXTREME_POWER_FACTOR * 100.0d0) / 200.0d0, 1.0d0)
            explosion_severity = explosion_severity + power_excess
        end if
        
    end subroutine detect_explosion

    ! =========================================================================
    ! Check safety limits and return alert flags
    ! Returns bit flags: 1=power, 2=reactivity, 4=prompt_critical, 
    !                    8=fuel_temp, 16=void, 32=period
    ! =========================================================================
    subroutine check_safety_limits(power_percent, reactivity_dollars, fuel_temp, &
                                   coolant_void, period, alert_flags) &
                                   bind(C, name="check_safety_limits")
        real(c_double), intent(in), value :: power_percent
        real(c_double), intent(in), value :: reactivity_dollars
        real(c_double), intent(in), value :: fuel_temp
        real(c_double), intent(in), value :: coolant_void
        real(c_double), intent(in), value :: period
        integer(c_int), intent(out) :: alert_flags
        
        alert_flags = 0
        
        ! Power exceeds 110%
        if (power_percent > 110.0d0) then
            alert_flags = ior(alert_flags, 1)
        end if
        
        ! Reactivity exceeds 0.5$
        if (reactivity_dollars > 0.5d0) then
            alert_flags = ior(alert_flags, 2)
        end if
        
        ! Prompt critical
        if (reactivity_dollars > 1.0d0) then
            alert_flags = ior(alert_flags, 4)
        end if
        
        ! Fuel temperature exceeds limit
        if (fuel_temp > 1200.0d0) then
            alert_flags = ior(alert_flags, 8)
        end if
        
        ! High void fraction
        if (coolant_void > 50.0d0) then
            alert_flags = ior(alert_flags, 16)
        end if
        
        ! Short period (positive and < 20s)
        if (period > 0.0d0 .and. period < 20.0d0) then
            alert_flags = ior(alert_flags, 32)
        end if
        
    end subroutine check_safety_limits

end module rbmk_safety
