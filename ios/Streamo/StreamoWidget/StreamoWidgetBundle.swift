//
//  StreamoWidgetBundle.swift
//  StreamoWidget
//
//  Created by Matteo Scanferla on 27/05/26.
//

import WidgetKit
import SwiftUI

@main
struct StreamoWidgetBundle: WidgetBundle {
    var body: some Widget {
        StreamoWidget()
        DownloadLiveActivity()
    }
}
