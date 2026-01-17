! =============================================================================
! RBMK Spatial Physics Module
! 2D neutron diffusion and per-channel thermal-hydraulics
! =============================================================================
!
! This module implements spatial physics for the RBMK reactor:
! - 2D neutron diffusion equation with neighbor coupling
! - Per-channel thermal-hydraulic calculations
! - Per-channel xenon dynamics
! - Local reactivity feedback
!
! The reactor core is modeled as 1661 fuel channels with 4-connectivity
! (each channel exchanges neutrons/heat with up to 4 neighbors)
!
! =============================================================================

module rbmk_spatial
    use iso_c_binding
    use rbmk_constants
    implicit none
    
    ! Maximum number of channels
    integer, parameter :: MAX_CHANNELS = 1700
    
    ! Maximum neighbors per channel (4-connectivity)
    integer, parameter :: MAX_NEIGHBORS = 4
    
    ! Diffusion coupling coefficient (cm^2/s)
    ! Controls how fast neutrons diffuse between neighboring channels
    real(c_double), parameter :: DIFFUSION_COUPLING = 50.0d0
    
    ! Thermal coupling coefficient (W/K)
    ! Controls heat transfer through graphite between channels
    real(c_double), parameter :: THERMAL_COUPLING = 100.0d0
    
    ! Grid spacing (cm) - distance between channel centers
    real(c_double), parameter :: GRID_SPACING = 25.0d0
    
contains

    ! =========================================================================
    ! Perform one spatial simulation step for all channels
    ! This is the main entry point for 2D physics
    ! =========================================================================
    subroutine spatial_simulation_step( &
        ! Number of channels
        num_channels, &
        ! Time step
        dt, &
        ! Global parameters
        total_rod_worth, scram_active, &
        ! Per-channel input arrays (size: num_channels)
        neutron_flux_in, precursors_in, &
        fuel_temp_in, coolant_temp_in, graphite_temp_in, coolant_void_in, &
        iodine_in, xenon_in, &
        local_rod_worth_in, &
        ! Neighbor connectivity (size: num_channels * MAX_NEIGHBORS)
        ! -1 means no neighbor at that position
        neighbor_indices, num_neighbors, &
        ! Channel positions for radial power profile
        channel_x, channel_y, &
        ! Per-channel output arrays (size: num_channels)
        neutron_flux_out, precursors_out, &
        fuel_temp_out, coolant_temp_out, graphite_temp_out, coolant_void_out, &
        iodine_out, xenon_out, &
        local_power_out, local_reactivity_out &
    ) bind(C, name="spatial_simulation_step")
        
        ! Number of channels
        integer(c_int), intent(in), value :: num_channels
        
        ! Time step
        real(c_double), intent(in), value :: dt
        
        ! Global parameters
        real(c_double), intent(in), value :: total_rod_worth
        integer(c_int), intent(in), value :: scram_active
        
        ! Per-channel input arrays
        real(c_double), intent(in) :: neutron_flux_in(num_channels)
        real(c_double), intent(in) :: precursors_in(num_channels)
        real(c_double), intent(in) :: fuel_temp_in(num_channels)
        real(c_double), intent(in) :: coolant_temp_in(num_channels)
        real(c_double), intent(in) :: graphite_temp_in(num_channels)
        real(c_double), intent(in) :: coolant_void_in(num_channels)
        real(c_double), intent(in) :: iodine_in(num_channels)
        real(c_double), intent(in) :: xenon_in(num_channels)
        real(c_double), intent(in) :: local_rod_worth_in(num_channels)
        
        ! Neighbor connectivity
        integer(c_int), intent(in) :: neighbor_indices(num_channels * MAX_NEIGHBORS)
        integer(c_int), intent(in) :: num_neighbors(num_channels)
        
        ! Channel positions
        real(c_double), intent(in) :: channel_x(num_channels)
        real(c_double), intent(in) :: channel_y(num_channels)
        
        ! Per-channel output arrays
        real(c_double), intent(out) :: neutron_flux_out(num_channels)
        real(c_double), intent(out) :: precursors_out(num_channels)
        real(c_double), intent(out) :: fuel_temp_out(num_channels)
        real(c_double), intent(out) :: coolant_temp_out(num_channels)
        real(c_double), intent(out) :: graphite_temp_out(num_channels)
        real(c_double), intent(out) :: coolant_void_out(num_channels)
        real(c_double), intent(out) :: iodine_out(num_channels)
        real(c_double), intent(out) :: xenon_out(num_channels)
        real(c_double), intent(out) :: local_power_out(num_channels)
        real(c_double), intent(out) :: local_reactivity_out(num_channels)
        
        ! Local variables
        integer :: i, j, n, neighbor_idx
        real(c_double) :: local_reactivity, k_local
        real(c_double) :: diffusion_term, production_term, absorption_term
        real(c_double) :: flux_sum, neighbor_flux
        real(c_double) :: thermal_exchange, neighbor_temp
        real(c_double) :: radial_factor, radius
        real(c_double) :: xenon_absorption
        real(c_double) :: dn_dt, dc_dt
        real(c_double) :: power_density
        
        ! Process each channel
        do i = 1, num_channels
            
            ! =====================================================
            ! Step 1: Calculate local reactivity with all feedbacks
            ! =====================================================
            call calculate_local_reactivity( &
                fuel_temp_in(i), graphite_temp_in(i), coolant_void_in(i), &
                xenon_in(i), local_rod_worth_in(i), total_rod_worth, &
                scram_active, local_reactivity)
            
            local_reactivity_out(i) = local_reactivity
            
            ! Calculate local k_eff
            if (abs(local_reactivity) < 0.99d0) then
                k_local = 1.0d0 / (1.0d0 - local_reactivity)
            else
                k_local = 1.0d0
            end if
            
            ! =====================================================
            ! Step 2: Calculate radial power profile factor
            ! =====================================================
            ! Cosine-like radial distribution (higher in center)
            radius = sqrt(channel_x(i)**2 + channel_y(i)**2)
            radial_factor = cos(3.14159d0 * radius / (2.0d0 * CORE_RADIUS))
            radial_factor = max(radial_factor, 0.3d0)  ! Minimum 30% at edge
            
            ! =====================================================
            ! Step 3: 2D Neutron Diffusion
            ! =====================================================
            ! Diffusion equation: dφ/dt = D∇²φ + (νΣf - Σa)φ + S
            ! Discretized: dφ/dt = D/h² * Σ(φ_neighbor - φ) + (k-1)/l * φ + λC
            
            ! Diffusion term: exchange with neighbors
            diffusion_term = 0.0d0
            flux_sum = 0.0d0
            n = num_neighbors(i)
            
            do j = 1, n
                neighbor_idx = neighbor_indices((i-1) * MAX_NEIGHBORS + j)
                if (neighbor_idx > 0 .and. neighbor_idx <= num_channels) then
                    neighbor_flux = neutron_flux_in(neighbor_idx)
                    diffusion_term = diffusion_term + (neighbor_flux - neutron_flux_in(i))
                    flux_sum = flux_sum + neighbor_flux
                end if
            end do
            
            ! Scale diffusion by coupling coefficient and grid spacing
            diffusion_term = DIFFUSION_COUPLING / (GRID_SPACING**2) * diffusion_term
            
            ! Production term: (k-1)/l * φ (fission minus absorption)
            ! For prompt neutrons: (1-β)(k-1)/l * φ
            ! This is the main driver of power changes
            production_term = (1.0d0 - BETA_EFF) * (k_local - 1.0d0) / NEUTRON_LIFETIME * neutron_flux_in(i)
            
            ! Xenon absorption term (already included in k_local via reactivity)
            ! Don't double-count xenon
            xenon_absorption = 0.0d0
            
            ! Delayed neutron source: λC
            ! This provides the "inertia" that keeps the reactor stable
            
            ! Total rate of change for prompt neutrons
            ! dφ/dt = (1-β)(k-1)/l * φ + λC + diffusion
            dn_dt = diffusion_term + production_term + &
                    LAMBDA_DECAY * precursors_in(i)
            
            ! Update neutron flux (explicit Euler)
            neutron_flux_out(i) = neutron_flux_in(i) + dn_dt * dt
            neutron_flux_out(i) = max(neutron_flux_out(i), 1.0d-10)
            
            ! =====================================================
            ! Step 4: Delayed Neutron Precursors
            ! =====================================================
            ! dC/dt = β/l * φ - λC
            dc_dt = BETA_EFF / NEUTRON_LIFETIME * neutron_flux_in(i) - &
                    LAMBDA_DECAY * precursors_in(i)
            
            precursors_out(i) = precursors_in(i) + dc_dt * dt
            precursors_out(i) = max(precursors_out(i), 0.0d0)
            
            ! =====================================================
            ! Step 5: Calculate local power
            ! =====================================================
            ! Power proportional to flux * radial factor
            power_density = neutron_flux_out(i) * radial_factor
            local_power_out(i) = power_density * NOMINAL_POWER / real(NUM_CHANNELS, c_double)
            
            ! =====================================================
            ! Step 6: Per-channel thermal-hydraulics
            ! =====================================================
            call update_channel_temperatures( &
                local_power_out(i), &
                fuel_temp_in(i), coolant_temp_in(i), graphite_temp_in(i), coolant_void_in(i), &
                dt, &
                fuel_temp_out(i), coolant_temp_out(i), graphite_temp_out(i), coolant_void_out(i))
            
            ! Add thermal coupling with neighbors (heat conduction through graphite)
            thermal_exchange = 0.0d0
            do j = 1, n
                neighbor_idx = neighbor_indices((i-1) * MAX_NEIGHBORS + j)
                if (neighbor_idx > 0 .and. neighbor_idx <= num_channels) then
                    neighbor_temp = graphite_temp_in(neighbor_idx)
                    thermal_exchange = thermal_exchange + (neighbor_temp - graphite_temp_in(i))
                end if
            end do
            
            ! Apply thermal exchange (small effect)
            graphite_temp_out(i) = graphite_temp_out(i) + &
                THERMAL_COUPLING * thermal_exchange * dt / (GRAPHITE_TIME_CONST * 1000.0d0)
            
            ! =====================================================
            ! Step 7: Per-channel xenon dynamics
            ! =====================================================
            call update_channel_xenon( &
                iodine_in(i), xenon_in(i), neutron_flux_out(i), dt, &
                iodine_out(i), xenon_out(i))
            
        end do
        
    end subroutine spatial_simulation_step
    
    ! =========================================================================
    ! Calculate local reactivity for a single channel
    ! =========================================================================
    subroutine calculate_local_reactivity( &
        fuel_temp, graphite_temp, coolant_void, &
        xenon_conc, local_rod_worth, total_rod_worth, &
        scram_active, reactivity)
        
        real(c_double), intent(in) :: fuel_temp
        real(c_double), intent(in) :: graphite_temp
        real(c_double), intent(in) :: coolant_void
        real(c_double), intent(in) :: xenon_conc
        real(c_double), intent(in) :: local_rod_worth
        real(c_double), intent(in) :: total_rod_worth
        integer(c_int), intent(in) :: scram_active
        real(c_double), intent(out) :: reactivity
        
        real(c_double) :: rho_fuel, rho_void, rho_graphite, rho_xenon, rho_rods
        real(c_double) :: xenon_eq
        
        ! Base reactivity (excess reactivity of fresh core)
        reactivity = BASE_REACTIVITY
        
        ! Fuel temperature feedback (Doppler effect - NEGATIVE)
        rho_fuel = ALPHA_FUEL * (fuel_temp - REF_FUEL_TEMP)
        
        ! Void coefficient feedback (POSITIVE in RBMK)
        rho_void = ALPHA_VOID * coolant_void
        
        ! Graphite temperature feedback (slightly positive)
        rho_graphite = ALPHA_GRAPHITE * (graphite_temp - REF_GRAPHITE_TEMP)
        
        ! Xenon poisoning (always negative)
        xenon_eq = 3.0d15  ! Equilibrium xenon at full power
        if (xenon_conc > 0.0d0) then
            rho_xenon = -0.03d0 * (xenon_conc / xenon_eq)
        else
            rho_xenon = 0.0d0
        end if
        
        ! Control rod worth (negative when inserted)
        if (scram_active /= 0) then
            rho_rods = -total_rod_worth - local_rod_worth
        else
            rho_rods = -total_rod_worth - local_rod_worth
        end if
        
        ! Total reactivity
        reactivity = reactivity + rho_fuel + rho_void + rho_graphite + rho_xenon + rho_rods
        
        ! Clamp to reasonable range
        reactivity = max(-0.2d0, min(0.1d0, reactivity))
        
    end subroutine calculate_local_reactivity
    
    ! =========================================================================
    ! Update temperatures for a single channel
    ! =========================================================================
    subroutine update_channel_temperatures( &
        local_power, &
        fuel_temp_in, coolant_temp_in, graphite_temp_in, coolant_void_in, &
        dt, &
        fuel_temp_out, coolant_temp_out, graphite_temp_out, coolant_void_out)
        
        real(c_double), intent(in) :: local_power
        real(c_double), intent(in) :: fuel_temp_in
        real(c_double), intent(in) :: coolant_temp_in
        real(c_double), intent(in) :: graphite_temp_in
        real(c_double), intent(in) :: coolant_void_in
        real(c_double), intent(in) :: dt
        real(c_double), intent(out) :: fuel_temp_out
        real(c_double), intent(out) :: coolant_temp_out
        real(c_double), intent(out) :: graphite_temp_out
        real(c_double), intent(out) :: coolant_void_out
        
        real(c_double) :: power_fraction, target_fuel_temp, target_coolant_temp
        real(c_double) :: target_graphite_temp, target_void
        real(c_double) :: fuel_tau, coolant_tau, graphite_tau, void_tau
        
        ! Power fraction (relative to nominal per-channel power)
        power_fraction = local_power / (NOMINAL_POWER / real(NUM_CHANNELS, c_double))
        power_fraction = max(0.0d0, power_fraction)
        
        ! Target temperatures based on power
        ! At 100% power: fuel ~900K, coolant ~560K, graphite ~650K
        target_fuel_temp = 300.0d0 + 600.0d0 * power_fraction
        target_coolant_temp = 300.0d0 + 260.0d0 * power_fraction
        target_graphite_temp = 300.0d0 + 350.0d0 * power_fraction
        
        ! Void formation above saturation temperature
        if (coolant_temp_in > SATURATION_TEMP) then
            target_void = min(100.0d0, (coolant_temp_in - SATURATION_TEMP) * 2.0d0)
        else
            target_void = 0.0d0
        end if
        
        ! Time constants (faster response at higher power)
        fuel_tau = 5.0d0 / max(power_fraction, 0.1d0)
        coolant_tau = COOLANT_TIME_CONST
        graphite_tau = GRAPHITE_TIME_CONST
        void_tau = VOID_TIME_CONST
        
        ! First-order lag response
        fuel_temp_out = fuel_temp_in + (target_fuel_temp - fuel_temp_in) * dt / fuel_tau
        coolant_temp_out = coolant_temp_in + (target_coolant_temp - coolant_temp_in) * dt / coolant_tau
        graphite_temp_out = graphite_temp_in + (target_graphite_temp - graphite_temp_in) * dt / graphite_tau
        coolant_void_out = coolant_void_in + (target_void - coolant_void_in) * dt / void_tau
        
        ! Clamp values
        fuel_temp_out = max(290.0d0, min(3000.0d0, fuel_temp_out))
        coolant_temp_out = max(290.0d0, min(700.0d0, coolant_temp_out))
        graphite_temp_out = max(290.0d0, min(1500.0d0, graphite_temp_out))
        coolant_void_out = max(0.0d0, min(100.0d0, coolant_void_out))
        
    end subroutine update_channel_temperatures
    
    ! =========================================================================
    ! Update xenon/iodine for a single channel
    ! =========================================================================
    subroutine update_channel_xenon( &
        iodine_in, xenon_in, neutron_flux, dt, &
        iodine_out, xenon_out)
        
        real(c_double), intent(in) :: iodine_in
        real(c_double), intent(in) :: xenon_in
        real(c_double), intent(in) :: neutron_flux
        real(c_double), intent(in) :: dt
        real(c_double), intent(out) :: iodine_out
        real(c_double), intent(out) :: xenon_out
        
        real(c_double) :: fission_rate, di_dt, dxe_dt
        real(c_double) :: flux_scaled
        
        ! Scale flux to physical units (assuming neutron_flux is normalized)
        flux_scaled = neutron_flux * 1.0d14
        
        ! Fission rate proportional to flux
        fission_rate = SIGMA_F * flux_scaled
        
        ! Iodine-135 dynamics
        ! dI/dt = γ_I * Σ_f * φ - λ_I * I
        di_dt = GAMMA_I * fission_rate - LAMBDA_I * iodine_in
        iodine_out = iodine_in + di_dt * dt
        iodine_out = max(0.0d0, iodine_out)
        
        ! Xenon-135 dynamics
        ! dXe/dt = γ_Xe * Σ_f * φ + λ_I * I - λ_Xe * Xe - σ_Xe * φ * Xe
        dxe_dt = GAMMA_XE * fission_rate + LAMBDA_I * iodine_in &
               - LAMBDA_XE * xenon_in - SIGMA_XE * flux_scaled * xenon_in
        xenon_out = xenon_in + dxe_dt * dt
        xenon_out = max(0.0d0, xenon_out)
        
    end subroutine update_channel_xenon
    
    ! =========================================================================
    ! Initialize channel flux with cosine radial distribution
    ! =========================================================================
    subroutine initialize_flux_distribution( &
        num_channels, channel_x, channel_y, initial_power, &
        neutron_flux_out) bind(C, name="initialize_flux_distribution")
        
        integer(c_int), intent(in), value :: num_channels
        real(c_double), intent(in) :: channel_x(num_channels)
        real(c_double), intent(in) :: channel_y(num_channels)
        real(c_double), intent(in), value :: initial_power
        real(c_double), intent(out) :: neutron_flux_out(num_channels)
        
        integer :: i
        real(c_double) :: radius, radial_factor, base_flux
        
        ! Base flux level from power
        base_flux = initial_power / NOMINAL_POWER
        
        do i = 1, num_channels
            radius = sqrt(channel_x(i)**2 + channel_y(i)**2)
            radial_factor = cos(3.14159d0 * radius / (2.0d0 * CORE_RADIUS))
            radial_factor = max(radial_factor, 0.3d0)
            
            neutron_flux_out(i) = base_flux * radial_factor
        end do
        
    end subroutine initialize_flux_distribution
    
    ! =========================================================================
    ! Calculate global averages from per-channel data
    ! =========================================================================
    subroutine calculate_global_averages( &
        num_channels, &
        fuel_temp, coolant_temp, graphite_temp, coolant_void, &
        local_power, xenon, &
        avg_fuel_temp, avg_coolant_temp, avg_graphite_temp, avg_void, &
        total_power, avg_xenon) bind(C, name="calculate_global_averages")
        
        integer(c_int), intent(in), value :: num_channels
        real(c_double), intent(in) :: fuel_temp(num_channels)
        real(c_double), intent(in) :: coolant_temp(num_channels)
        real(c_double), intent(in) :: graphite_temp(num_channels)
        real(c_double), intent(in) :: coolant_void(num_channels)
        real(c_double), intent(in) :: local_power(num_channels)
        real(c_double), intent(in) :: xenon(num_channels)
        real(c_double), intent(out) :: avg_fuel_temp
        real(c_double), intent(out) :: avg_coolant_temp
        real(c_double), intent(out) :: avg_graphite_temp
        real(c_double), intent(out) :: avg_void
        real(c_double), intent(out) :: total_power
        real(c_double), intent(out) :: avg_xenon
        
        integer :: i
        real(c_double) :: n
        
        n = real(num_channels, c_double)
        
        avg_fuel_temp = 0.0d0
        avg_coolant_temp = 0.0d0
        avg_graphite_temp = 0.0d0
        avg_void = 0.0d0
        total_power = 0.0d0
        avg_xenon = 0.0d0
        
        do i = 1, num_channels
            avg_fuel_temp = avg_fuel_temp + fuel_temp(i)
            avg_coolant_temp = avg_coolant_temp + coolant_temp(i)
            avg_graphite_temp = avg_graphite_temp + graphite_temp(i)
            avg_void = avg_void + coolant_void(i)
            total_power = total_power + local_power(i)
            avg_xenon = avg_xenon + xenon(i)
        end do
        
        avg_fuel_temp = avg_fuel_temp / n
        avg_coolant_temp = avg_coolant_temp / n
        avg_graphite_temp = avg_graphite_temp / n
        avg_void = avg_void / n
        avg_xenon = avg_xenon / n
        
    end subroutine calculate_global_averages

end module rbmk_spatial
