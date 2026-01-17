! =============================================================================
! RBMK Safety Module
! Explosion detection and safety calculations
! =============================================================================

module rbmk_safety
    use iso_c_binding
    use rbmk_constants
    implicit none
    
    ! Module-level state for tracking peak values and energy deposition
    ! These are critical for detecting explosions that occur during power excursions
    ! even after the reactivity becomes negative due to Doppler feedback
    real(c_double), save :: peak_power_percent = 0.0d0      ! Peak power seen [%]
    real(c_double), save :: peak_fuel_temp = 300.0d0        ! Peak fuel temperature [K]
    real(c_double), save :: energy_deposited = 0.0d0        ! Cumulative energy during excursion [MJ]
    real(c_double), save :: excursion_start_time = -1.0d0   ! When excursion started [s]
    logical, save :: in_excursion = .false.                 ! Currently in power excursion
    
    ! Thresholds for excursion detection
    real(c_double), parameter :: EXCURSION_POWER_THRESHOLD = 150.0d0  ! % - start tracking at 150%
    real(c_double), parameter :: EXCURSION_END_THRESHOLD = 50.0d0     ! % - end excursion below 50%
    real(c_double), parameter :: CRITICAL_ENERGY_MJ = 500.0d0         ! MJ - energy threshold for damage
    real(c_double), parameter :: CATASTROPHIC_POWER = 1000.0d0        ! % - instant explosion at 10x nominal
    real(c_double), parameter :: CRITICAL_FUEL_TEMP_EXCURSION = 2000.0d0 ! K - fuel damage threshold
    
contains

    ! =========================================================================
    ! Reset explosion tracking state (called on simulation reset)
    ! =========================================================================
    subroutine reset_explosion_state() bind(C, name="reset_explosion_state")
        peak_power_percent = 0.0d0
        peak_fuel_temp = 300.0d0
        energy_deposited = 0.0d0
        excursion_start_time = -1.0d0
        in_excursion = .false.
    end subroutine reset_explosion_state

    ! =========================================================================
    ! Detect steam explosion based on physics conditions
    ! Returns explosion severity (0 = safe, >= 1.0 = explosion)
    !
    ! Physics-based explosion criteria:
    ! 1. Fuel temperature exceeding melting point (UO2 melts at ~2800K)
    ! 2. Rapid energy deposition during power excursion (adiabatic heating)
    ! 3. Extreme power levels causing instant fuel damage
    ! 4. Steam explosion from fuel-coolant interaction at high temperatures
    !
    ! Key insight: After a prompt-critical excursion, Doppler feedback makes
    ! reactivity negative, but the damage is already done. We must track
    ! peak values and cumulative energy, not just instantaneous state.
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
        
        real(c_double) :: void_excess, temp_excess, power_excess
        real(c_double) :: energy_severity, temp_severity
        
        explosion_severity = 0.0d0
        
        ! Track peak values during excursion
        if (power_percent > peak_power_percent) then
            peak_power_percent = power_percent
        end if
        if (fuel_temp > peak_fuel_temp) then
            peak_fuel_temp = fuel_temp
        end if
        
        ! Manage excursion state
        if (.not. in_excursion .and. power_percent > EXCURSION_POWER_THRESHOLD) then
            in_excursion = .true.
            energy_deposited = 0.0d0
        else if (in_excursion .and. power_percent < EXCURSION_END_THRESHOLD) then
            ! Excursion ended - check if damage occurred
            in_excursion = .false.
        end if
        
        ! Accumulate energy during excursion (simplified: power * dt, assuming dt ~ 0.1s)
        ! Energy in MJ = Power_MW * time_s / 1000
        ! At 3200 MW nominal, 1000% = 32000 MW
        if (in_excursion .or. power_percent > 100.0d0) then
            energy_deposited = energy_deposited + (power_percent / 100.0d0) * NOMINAL_POWER * 0.1d0 / 1000.0d0
        end if
        
        ! =====================================================================
        ! Condition 1: Fuel temperature exceeding critical thresholds
        ! This is the primary physical mechanism - fuel damage/melting
        ! Use PEAK fuel temperature - damage is irreversible once it occurs
        ! =====================================================================
        if (peak_fuel_temp > FUEL_MELTING_POINT) then
            ! Fuel has melted - guaranteed explosion
            explosion_severity = explosion_severity + 2.0d0
        else if (peak_fuel_temp > FUEL_MELTING_POINT * 0.9d0) then
            ! Approached melting point - severe damage occurred
            temp_severity = (peak_fuel_temp - FUEL_MELTING_POINT * 0.9d0) / (FUEL_MELTING_POINT * 0.1d0)
            explosion_severity = explosion_severity + temp_severity
        else if (peak_fuel_temp > CRITICAL_FUEL_TEMP_EXCURSION) then
            ! High temperature during excursion - fuel cladding failure likely
            temp_severity = (peak_fuel_temp - CRITICAL_FUEL_TEMP_EXCURSION) / &
                           (FUEL_MELTING_POINT * 0.9d0 - CRITICAL_FUEL_TEMP_EXCURSION)
            explosion_severity = explosion_severity + temp_severity * 0.5d0
        end if
        
        ! =====================================================================
        ! Condition 2: Catastrophic power excursion
        ! At extreme power levels, fuel damage is instantaneous regardless of
        ! current reactivity (which may already be negative due to Doppler)
        !
        ! CRITICAL: Use PEAK power, not current power!
        ! After a prompt-critical excursion, Doppler feedback makes reactivity
        ! negative and power drops rapidly, but the damage is already done.
        ! =====================================================================
        if (peak_power_percent > CATASTROPHIC_POWER) then
            ! Peak power exceeded 10x nominal - fuel damage occurred
            ! This is irreversible - once the fuel is damaged, explosion follows
            power_excess = (peak_power_percent - CATASTROPHIC_POWER) / CATASTROPHIC_POWER
            explosion_severity = explosion_severity + 1.0d0 + power_excess
        end if
        
        ! =====================================================================
        ! Condition 3: Cumulative energy deposition
        ! Even moderate power excursions can cause damage if sustained
        ! =====================================================================
        if (energy_deposited > CRITICAL_ENERGY_MJ) then
            energy_severity = (energy_deposited - CRITICAL_ENERGY_MJ) / CRITICAL_ENERGY_MJ
            explosion_severity = explosion_severity + min(energy_severity, 1.0d0)
        end if
        
        ! =====================================================================
        ! Condition 4: Steam explosion from fuel-coolant interaction
        ! Hot fuel + water = rapid steam generation = pressure spike
        ! =====================================================================
        if (coolant_void > CRITICAL_VOID_FRACTION .and. &
            coolant_temp > CRITICAL_COOLANT_TEMP) then
            void_excess = min((coolant_void - CRITICAL_VOID_FRACTION) / 25.0d0, 1.0d0)
            temp_excess = min((coolant_temp - CRITICAL_COOLANT_TEMP) / 300.0d0, 1.0d0)
            explosion_severity = explosion_severity + void_excess * temp_excess
        end if
        
        ! =====================================================================
        ! Condition 5: Combined thermal-mechanical failure
        ! High fuel temp + high void = fuel fragmentation + steam explosion
        ! This is what happened at Chernobyl
        ! =====================================================================
        if (fuel_temp > CRITICAL_FUEL_TEMP_EXCURSION .and. coolant_void > 50.0d0) then
            temp_severity = (fuel_temp - CRITICAL_FUEL_TEMP_EXCURSION) / &
                           (FUEL_MELTING_POINT - CRITICAL_FUEL_TEMP_EXCURSION)
            void_excess = (coolant_void - 50.0d0) / 50.0d0
            explosion_severity = explosion_severity + temp_severity * void_excess * 0.5d0
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
